// Assistente de IA dentro do sistema ("converse com a IA sem sair da ferramenta").
// Usa o Claude com as mesmas ferramentas do conector (busca de licitações, leitura de edital)
// e mais algumas do próprio sistema (negócios do usuário, habilitação, adicionar ao funil).
import { z } from 'zod';
import { httpError } from '../http.js';
import { FERRAMENTAS as FERRAMENTAS_CONECTOR, jsonSchema } from './conector.js';
import { MODELO, FALLBACK, checarLimite, registrarUso, comMensagensClaras } from './editalIA.js';
import { habilitacaoDoNegocio, resumoHabilitacao } from './habilitacao.js';
import { CHECKLIST_PADRAO } from '../routes/negocios.js';

const MAX_VOLTAS = 8;
const LIMITE_DIARIO_ASSISTENTE = Number(process.env.ASSISTENTE_LIMITE_DIARIO ?? 300);

const NOMES_ETAPA = { triagem: 'Triagem', analise: 'Em análise', proposta: 'Proposta', disputa: 'Disputa', ganho: 'Ganho', perdido: 'Perdido' };

// Ferramentas só do assistente (dentro do sistema, conhecem o usuário logado).
const FERRAMENTAS_SISTEMA = {
  meus_negocios: {
    descricao: 'Lista os negócios (licitações no funil) do usuário, com etapa, data da disputa e empresa. Use para perguntas sobre "meus negócios", "meu funil", "o que tenho para disputar".',
    args: z.object({ etapa: z.enum(['triagem', 'analise', 'proposta', 'disputa', 'ganho', 'perdido']).optional() }),
    async executar(ctx, a) {
      const itens = ctx.db.prepare(`SELECT n.id, n.titulo, n.etapa, n.data_disputa, e.razao_social AS empresa, o.orgao_nome, o.municipio, o.uf, o.valor_estimado, o.id AS oportunidade_id
        FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id LEFT JOIN empresas e ON e.id = n.empresa_id
        WHERE n.usuario_id = ? AND n.arquivado = 0 ${a.etapa ? 'AND n.etapa = ?' : ''} ORDER BY n.data_disputa IS NULL, n.data_disputa LIMIT 50`)
        .all(...(a.etapa ? [ctx.uid, a.etapa] : [ctx.uid]));
      return {
        total: itens.length,
        negocios: itens.map((n) => ({ ...n, etapa: NOMES_ETAPA[n.etapa] ?? n.etapa, link: `${ctx.appUrl}/#/negocios/${n.id}` })),
      };
    },
  },
  conferir_habilitacao: {
    descricao: 'Confere se o usuário está apto a participar de um negócio: compara os documentos exigidos no edital (lido pela IA) com os documentos cadastrados e a validade na data da sessão.',
    args: z.object({ negocio_id: z.number().int().positive().describe('O id do negócio (de meus_negocios)') }),
    async executar(ctx, a) {
      const h = habilitacaoDoNegocio(ctx.db, ctx.uid, a.negocio_id);
      if (!h) throw httpError(404, 'Negócio não encontrado.');
      if (!h.lido) return { lido: false, aviso: 'O edital ainda não foi lido pela IA. Use verificar_edital com o id da licitação (oportunidade_id) e depois confira de novo.', oportunidade_id: h.oportunidadeId };
      return { apto: h.apto, resumo: resumoHabilitacao(h), data_sessao: h.dataSessao, itens: h.itens.map((i) => ({ exigencia: i.descricao, situacao: i.situacao, documento: i.documento })) };
    },
  },
  adicionar_ao_funil: {
    descricao: 'Coloca uma licitação nos negócios do usuário (etapa Triagem). Só use quando o usuário pedir explicitamente para adicionar/colocar no funil.',
    args: z.object({ id: z.number().int().positive().describe('O id da licitação (de buscar_licitacoes)') }),
    async executar(ctx, a) {
      const op = ctx.db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(a.id);
      if (!op) throw httpError(404, 'Licitação não encontrada.');
      const ja = ctx.db.prepare('SELECT id FROM negocios WHERE usuario_id = ? AND oportunidade_id = ?').get(ctx.uid, op.id);
      if (ja) return { ja_estava: true, negocio_id: ja.id, link: `${ctx.appUrl}/#/negocios/${ja.id}` };
      const aberta = op.data_encerramento && ctx.db.prepare("SELECT ? >= strftime('%Y-%m-%dT%H:%M:%S','now','localtime') AS v").get(op.data_encerramento).v;
      if (!aberta) throw httpError(400, 'Esta licitação não recebe mais propostas (prazo encerrado ou compra direta).');
      const r = ctx.db.prepare(`INSERT INTO negocios (usuario_id, oportunidade_id, titulo, etapa, data_disputa) VALUES (?, ?, ?, 'triagem', ?) RETURNING id`)
        .get(ctx.uid, op.id, op.objeto.slice(0, 300), op.data_encerramento);
      const ins = ctx.db.prepare('INSERT INTO checklist_itens (negocio_id, texto, posicao) VALUES (?, ?, ?)');
      CHECKLIST_PADRAO.forEach((t, i) => ins.run(r.id, t, i));
      return { adicionado: true, negocio_id: r.id, link: `${ctx.appUrl}/#/negocios/${r.id}` };
    },
  },
};

export const FERRAMENTAS = {
  ...Object.fromEntries(Object.entries(FERRAMENTAS_CONECTOR).map(([k, f]) => [k, { descricao: f.descricao, args: f.args, executar: f.executar }])),
  ...FERRAMENTAS_SISTEMA,
};

export const ROTULOS = {
  buscar_licitacoes: 'Buscou licitações', detalhes_licitacao: 'Abriu a licitação', verificar_edital: 'Leu o edital com IA',
  perguntar_edital: 'Consultou o edital', meus_negocios: 'Viu seus negócios', conferir_habilitacao: 'Conferiu sua documentação',
  adicionar_ao_funil: 'Adicionou ao funil',
};

const definicoes = () => Object.entries(FERRAMENTAS).map(([name, f]) => ({ name, description: f.descricao, input_schema: jsonSchema(f.args) }));

function sistema(db, uid) {
  const u = db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(uid);
  const empresas = db.prepare('SELECT razao_social, cnpj FROM empresas WHERE usuario_id = ?').all(uid);
  return `Você é o assistente do Busca Pregão IA, um sistema para empresas que vendem para o governo brasileiro (licitações, Lei 14.133/2021).
Você conversa com ${u?.nome ?? 'o usuário'} dentro do sistema.${empresas.length ? ` Empresas dele: ${empresas.map((e) => `${e.razao_social} (CNPJ ${e.cnpj})`).join('; ')}.` : ''}
Responda em português do Brasil, de forma direta e prática. Use as ferramentas para buscar dados reais: licitações abertas do PNCP, editais, negócios e documentação do usuário.
Regras:
- Nunca invente licitações, valores, prazos ou exigências. Se não encontrou, diga.
- Ao listar licitações, mostre para cada uma: objeto curto, órgão e cidade/UF, valor estimado, prazo das propostas e o link do sistema em Markdown ([abrir](link)).
- Atestado de capacidade técnica: só afirme "não exige" quando a situação for "nao_exige" ou "nao_listado"; para "nao_verificado", ofereça ler o edital (verificar_edital, uma licitação por vez, leva 1 a 2 minutos e tem custo).
- Só adicione ao funil quando o usuário pedir.
- Seja breve: listas curtas, sem repetir o que o usuário já sabe. Valores em reais.`;
}

/** Texto visível de uma mensagem do assistente e as ferramentas usadas (para a tela). */
export function paraTela(m) {
  const conteudo = JSON.parse(m.conteudo);
  if (m.papel === 'user') {
    const texto = typeof conteudo === 'string' ? conteudo : conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return texto ? { id: m.id, papel: 'user', texto, criado_em: m.criado_em } : null; // resultados de ferramenta não aparecem
  }
  const texto = conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const ferramentas = conteudo.filter((b) => b.type === 'tool_use').map((b) => ROTULOS[b.name] ?? b.name);
  return { id: m.id, papel: 'assistant', texto, ferramentas, criado_em: m.criado_em };
}

export function conversaDoUsuario(db, uid, id) {
  const c = db.prepare('SELECT * FROM assistente_conversas WHERE id = ? AND usuario_id = ?').get(id, uid);
  if (!c) throw httpError(404, 'Conversa não encontrada.');
  return c;
}

/** Envia uma mensagem do usuário e roda o ciclo de ferramentas até a resposta final. */
export async function conversar(db, uid, { conversaId, mensagem }, { client, fetchImpl, appUrl }) {
  if (!client) throw httpError(503, 'A IA não está configurada no servidor (falta ANTHROPIC_API_KEY).');
  const texto = String(mensagem ?? '').trim();
  if (!texto) throw httpError(400, 'Escreva sua pergunta.');
  checarLimite(db, uid);
  const hojeN = db.prepare("SELECT count(*) AS n FROM ia_uso WHERE usuario_id = ? AND tipo = 'assistente' AND criado_em >= datetime('now', 'start of day')").get(uid).n;
  if (hojeN >= LIMITE_DIARIO_ASSISTENTE) throw httpError(429, 'Você atingiu o limite diário de uso do assistente. Tente amanhã.');

  const conversa = conversaId
    ? conversaDoUsuario(db, uid, conversaId)
    : db.prepare('INSERT INTO assistente_conversas (usuario_id, titulo) VALUES (?, ?) RETURNING *').get(uid, texto.slice(0, 80));
  const salvar = (papel, conteudo) => db.prepare('INSERT INTO assistente_mensagens (conversa_id, papel, conteudo) VALUES (?, ?, ?) RETURNING *')
    .get(conversa.id, papel, JSON.stringify(conteudo));
  // O histórico é só acrescentado, nunca editado (os blocos de raciocínio do modelo precisam voltar intactos).
  const historico = db.prepare('SELECT papel, conteudo FROM assistente_mensagens WHERE conversa_id = ? ORDER BY id').all(conversa.id)
    .map((m) => ({ role: m.papel, content: JSON.parse(m.conteudo) }));
  const novas = [salvar('user', [{ type: 'text', text: texto }])];
  historico.push({ role: 'user', content: [{ type: 'text', text: texto }] });

  const ctx = { db, uid, ia: client, fetchImpl, appUrl };
  const tools = definicoes();
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const resp = await comMensagensClaras(() => client.beta.messages.create({
      model: MODELO, max_tokens: 16000, ...FALLBACK, system: sistema(db, uid), tools, messages: historico,
      cache_control: { type: 'ephemeral' },
    }));
    registrarUso(db, uid, 'assistente', resp.usage, { modelo: resp.model ?? MODELO, referencia: `conv:${conversa.id}` });
    if (resp.stop_reason === 'refusal') {
      novas.push(salvar('assistant', [{ type: 'text', text: 'Não consigo ajudar com esse pedido. Tente reformular a pergunta.' }]));
      break;
    }
    historico.push({ role: 'assistant', content: resp.content });
    novas.push(salvar('assistant', resp.content));
    if (resp.stop_reason !== 'tool_use') break;
    const chamadas = resp.content.filter((b) => b.type === 'tool_use');
    const resultados = await Promise.all(chamadas.map(async (b) => {
      const f = FERRAMENTAS[b.name];
      if (!f) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: `Ferramenta desconhecida: ${b.name}` };
      const args = f.args.safeParse(b.input ?? {});
      if (!args.success) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: `Parâmetros inválidos: ${args.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
      try {
        return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await f.executar(ctx, args.data)) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: e.expose || (e.statusCode && e.statusCode < 500) ? e.message : 'Erro ao executar a ferramenta.' };
      }
    }));
    historico.push({ role: 'user', content: resultados });
    salvar('user', resultados);
  }
  db.prepare("UPDATE assistente_conversas SET atualizado_em = datetime('now') WHERE id = ?").run(conversa.id);
  return { conversaId: conversa.id, titulo: conversa.titulo, mensagens: novas.map(paraTela).filter(Boolean) };
}
