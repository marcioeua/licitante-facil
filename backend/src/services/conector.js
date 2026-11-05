// "Busca Pregão no Chat": servidor MCP (Model Context Protocol) para usar o sistema
// dentro do Claude e do ChatGPT. Transporte HTTP "streamable" sem sessão: cada POST
// traz uma mensagem JSON-RPC e recebe a resposta em JSON.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { buscarOportunidades, sugerirMunicipios } from './busca.js';
import { resumirEdital, perguntarEdital, exigenciaAtestado, comMensagensClaras } from './editalIA.js';
import { httpError } from '../http.js';

const VERSOES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MODALIDADES = { pregao: [6, 7], dispensa: [8], concorrencia: [4, 5], credenciamento: [12] };

// ---------- Link pessoal (token) ----------
const hash = (t) => createHash('sha256').update(String(t)).digest('hex');

export function gerarToken(db, uid) {
  const token = randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO conector_tokens (usuario_id, token_hash) VALUES (?, ?)
    ON CONFLICT(usuario_id) DO UPDATE SET token_hash = excluded.token_hash, criado_em = datetime('now'), ultimo_uso = NULL, chamadas = 0`)
    .run(uid, hash(token));
  return token;
}

export function usuarioDoToken(db, token) {
  if (!token || String(token).length < 20) return null;
  const r = db.prepare('SELECT usuario_id FROM conector_tokens WHERE token_hash = ?').get(hash(token));
  if (r) db.prepare("UPDATE conector_tokens SET ultimo_uso = datetime('now'), chamadas = chamadas + 1 WHERE usuario_id = ?").run(r.usuario_id);
  return r?.usuario_id ?? null;
}

// ---------- Ferramentas ----------
const resumoSalvo = (db, id) => {
  const r = db.prepare('SELECT resumo FROM edital_resumos WHERE oportunidade_id = ?').get(id);
  return r ? JSON.parse(r.resumo) : null;
};

function formatarOportunidade(db, o, appUrl) {
  return {
    id: o.id,
    objeto: o.objeto,
    orgao: o.orgao_nome,
    unidade: o.unidade_nome,
    cidade: o.municipio,
    uf: o.uf,
    modalidade: o.modalidade,
    numero: o.numero_compra && o.ano_compra ? `${o.numero_compra}/${o.ano_compra}` : null,
    valor_estimado: o.valor_estimado ?? null,
    registro_de_precos: !!o.registro_preco,
    abertura_propostas: o.data_abertura,
    encerramento_propostas: o.data_encerramento,
    situacao: o.situacao,
    pagometro: o.pagometro ?? null,
    atestado_capacidade_tecnica: exigenciaAtestado(resumoSalvo(db, o.id)),
    link_busca_pregao: appUrl ? `${appUrl}/#/oportunidades/${o.id}` : null,
    link_pncp: o.link_pncp,
    link_portal_disputa: o.link_origem,
  };
}

function resolverCidades(db, cidade, ufs) {
  if (!cidade) return [];
  const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return sugerirMunicipios(db, { q: cidade, uf: ufs.join(',') }, 50)
    .filter((m) => norm(m.nome.split('/')[0]) === norm(cidade))
    .map((m) => m.valor);
}

const BuscarArgs = z.object({
  texto: z.string().max(200).optional().describe('Palavras do objeto da compra, ex.: "material de limpeza", "notebook". Deixe vazio para qualquer objeto.'),
  ufs: z.array(z.string().length(2)).max(27).optional().describe('Siglas dos estados, ex.: ["SP", "MG"]'),
  cidade: z.string().max(80).optional().describe('Nome da cidade do órgão comprador, ex.: "Campinas"'),
  valor_min: z.number().nonnegative().optional().describe('Valor estimado mínimo, em reais'),
  valor_max: z.number().nonnegative().optional().describe('Valor estimado máximo, em reais (ex.: 50000 para "até 50 mil")'),
  modalidades: z.array(z.enum(['pregao', 'dispensa', 'concorrencia', 'credenciamento'])).optional(),
  atestado: z.enum(['qualquer', 'sem_atestado', 'com_atestado']).default('qualquer')
    .describe('Filtra pela exigência de atestado de capacidade técnica. Só é possível saber depois que a IA lê o edital; com "sem_atestado", as licitações ainda não verificadas também voltam, marcadas como "nao_verificado".'),
  apenas_abertas: z.boolean().default(true).describe('Somente licitações com prazo de proposta ainda aberto'),
  ordem: z.enum(['encerramento', 'valor', 'publicacao', 'relevancia']).optional().describe('encerramento = prazo mais próximo primeiro'),
  limite: z.number().int().min(1).max(50).default(15),
});

const IdArgs = z.object({ id: z.number().int().positive().describe('O "id" da licitação devolvido por buscar_licitacoes') });
const PerguntaArgs = IdArgs.extend({ pergunta: z.string().min(3).max(2000).describe('Pergunta sobre o edital, em português') });

function carregar(db, id) {
  const op = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id);
  if (!op) throw httpError(404, `Licitação ${id} não encontrada. Use buscar_licitacoes para obter o id.`);
  return op;
}

const FERRAMENTAS = {
  buscar_licitacoes: {
    titulo: 'Buscar licitações',
    descricao: 'Busca licitações públicas brasileiras (dados oficiais do PNCP) por objeto, estado, cidade, faixa de valor, modalidade e exigência de atestado de capacidade técnica. Valores em reais.',
    args: BuscarArgs,
    async executar(ctx, a) {
      const ufs = (a.ufs ?? []).map((u) => u.toUpperCase());
      const municipio = resolverCidades(ctx.db, a.cidade, ufs);
      if (a.cidade && !municipio.length) return { total: 0, licitacoes: [], aviso: `Nenhuma licitação aberta encontrada na cidade "${a.cidade}".` };
      const filtroAtestado = a.atestado !== 'qualquer';
      const filtros = {
        q: a.texto, uf: ufs, municipio, valorMin: a.valor_min, valorMax: a.valor_max,
        modalidade: (a.modalidades ?? []).flatMap((m) => MODALIDADES[m]),
        abertas: a.apenas_abertas, ordem: a.ordem, tamanho: filtroAtestado ? 100 : a.limite,
      };
      const r = buscarOportunidades(ctx.db, filtros, ctx.uid);
      let itens = r.itens;
      if (filtroAtestado) {
        // Primeiro as que já tiveram o edital lido pela IA (em qualquer posição da busca).
        const lidas = buscarOportunidades(ctx.db, { ...filtros, comResumo: true }, ctx.uid).itens;
        const ids = new Set(lidas.map((o) => o.id));
        itens = [...lidas, ...r.itens.filter((o) => !ids.has(o.id))];
      }
      let lista = itens.map((o) => formatarOportunidade(ctx.db, o, ctx.appUrl));
      if (a.atestado === 'sem_atestado') {
        const peso = { nao_exige: 0, nao_listado: 1, nao_informado: 2, nao_verificado: 3 };
        lista = lista.filter((o) => o.atestado_capacidade_tecnica.situacao !== 'exige')
          .sort((x, y) => peso[x.atestado_capacidade_tecnica.situacao] - peso[y.atestado_capacidade_tecnica.situacao]);
      } else if (a.atestado === 'com_atestado') {
        lista = lista.filter((o) => o.atestado_capacidade_tecnica.situacao === 'exige');
      }
      const contagem = {};
      for (const o of lista) contagem[o.atestado_capacidade_tecnica.situacao] = (contagem[o.atestado_capacidade_tecnica.situacao] ?? 0) + 1;
      return {
        total_pelos_filtros: r.total,
        analisadas: filtroAtestado ? itens.length : undefined,
        atestado_por_situacao: filtroAtestado ? contagem : undefined,
        licitacoes: lista.slice(0, a.limite),
        observacoes: [
          'valor_estimado null = órgão não divulgou (sigiloso); essas ficam fora quando há filtro de valor.',
          'atestado_capacidade_tecnica.situacao: nao_exige (o edital dispensa ou não pede), nao_listado (a IA não encontrou atestado na habilitação), exige, nao_informado (edital não deixa claro) ou nao_verificado (edital ainda não lido). Para verificar, use verificar_edital.',
        ],
      };
    },
  },
  detalhes_licitacao: {
    titulo: 'Detalhes da licitação',
    descricao: 'Mostra os dados de uma licitação e, se a IA já leu o edital, o resumo (documentos exigidos, prazos, pontos de atenção).',
    args: IdArgs,
    async executar(ctx, a) {
      const op = carregar(ctx.db, a.id);
      return { ...formatarOportunidade(ctx.db, op, ctx.appUrl), resumo_do_edital: resumoSalvo(ctx.db, op.id) };
    },
  },
  verificar_edital: {
    titulo: 'Ler edital com IA',
    descricao: 'Baixa o edital no PNCP e faz a IA ler: diz se exige atestado de capacidade técnica e lista documentos de habilitação, prazos, exclusividade ME/EPP e pontos de atenção. Pode levar 1 a 2 minutos por edital e conta no limite diário de análises; verifique uma licitação por vez.',
    args: IdArgs,
    async executar(ctx, a) {
      const op = carregar(ctx.db, a.id);
      const r = await comMensagensClaras(() => resumirEdital(ctx.db, op, ctx.uid, { client: ctx.ia, fetchImpl: ctx.fetchImpl }));
      const s = r.resumo;
      return {
        id: op.id,
        atestado_capacidade_tecnica: exigenciaAtestado(s),
        objeto: s.objeto, resumo: s.resumo, valor_estimado: s.valor_estimado, data_sessao: s.data_sessao,
        local_disputa: s.local_disputa, exclusivo_me_epp: s.exclusivo_me_epp,
        documentos_habilitacao: s.documentos_habilitacao, prazo_entrega_execucao: s.prazo_entrega_execucao,
        pontos_atencao: s.pontos_atencao, arquivos_lidos: r.arquivos?.map((f) => f.nome),
        link_busca_pregao: ctx.appUrl ? `${ctx.appUrl}/#/oportunidades/${op.id}` : null,
      };
    },
  },
  perguntar_edital: {
    titulo: 'Perguntar ao edital',
    descricao: 'Faz uma pergunta livre sobre o edital de uma licitação; a resposta cita as páginas. Conta no limite diário de análises com IA.',
    args: PerguntaArgs,
    async executar(ctx, a) {
      const op = carregar(ctx.db, a.id);
      const p = await comMensagensClaras(() => perguntarEdital(ctx.db, op, ctx.uid, a.pergunta, { client: ctx.ia, fetchImpl: ctx.fetchImpl }));
      return { resposta: p.resposta, citacoes: JSON.parse(p.citacoes) };
    },
  },
};

const INSTRUCOES = `Busca Pregão IA: licitações públicas brasileiras abertas (dados oficiais do PNCP) e leitura de editais com IA.
Responda em português do Brasil. Valores em reais.
Para "sem atestado de capacidade técnica": use buscar_licitacoes com atestado="sem_atestado". Só afirme que uma licitação não exige atestado quando a situação for "nao_exige" ou "nao_listado" (explique a diferença). Para as "nao_verificado", ofereça ler o edital com verificar_edital (uma por vez, leva 1 a 2 minutos). Nunca invente valores, prazos ou exigências; inclua o link de cada licitação.`;

const jsonSchema = (schema) => {
  const { $schema, ...resto } = z.toJSONSchema(schema, { io: 'input' });
  return resto;
};

function erroRpc(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** Trata uma mensagem JSON-RPC do cliente MCP. Devolve a resposta ou null (notificações). */
export async function tratarMensagem(m, ctx) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return m && 'id' in m && !m.method ? null : erroRpc(m?.id, -32600, 'Requisição inválida.');
  }
  if (m.id === undefined) return null; // notificação (ex.: notifications/initialized)
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize': {
      const pedida = m.params?.protocolVersion;
      return ok({
        protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'busca-pregao-ia', title: 'Busca Pregão IA', version: '1.0.0' },
        instructions: INSTRUCOES,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({
        tools: Object.entries(FERRAMENTAS).map(([name, f]) => ({
          name, title: f.titulo, description: f.descricao, inputSchema: jsonSchema(f.args),
          annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const f = FERRAMENTAS[m.params?.name];
      if (!f) return erroRpc(m.id, -32602, `Ferramenta desconhecida: ${m.params?.name}`);
      const args = f.args.safeParse(m.params?.arguments ?? {});
      if (!args.success) {
        return ok({ isError: true, content: [{ type: 'text', text: `Parâmetros inválidos: ${args.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }] });
      }
      try {
        const r = await f.executar(ctx, args.data);
        return ok({ content: [{ type: 'text', text: JSON.stringify(r) }] });
      } catch (e) {
        if (!(e.expose || (e.statusCode && e.statusCode < 500))) ctx.log?.error?.(e);
        const msg = e.expose || (e.statusCode && e.statusCode < 500) ? e.message : 'Erro interno. Tente novamente.';
        return ok({ isError: true, content: [{ type: 'text', text: msg }] });
      }
    }
    default:
      return erroRpc(m.id, -32601, `Método não suportado: ${m.method}`);
  }
}
