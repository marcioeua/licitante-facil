// Ata da sessão (documento público anexado pelo órgão no PNCP): todos os licitantes de cada item,
// com marca, modelo, valor e classificação. A IA lê o documento uma vez; o resultado vale para todos.
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../config.js';
import { httpError } from '../http.js';
import { MODELO, FALLBACK, checarLimite, registrarUso } from './editalIA.js';
import { expandirArquivo } from './editalArquivos.js';

const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;
const MAX_PAGINAS_ATA = 90;
const pncpApi = () => config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');

// Prioridade dos documentos que costumam listar as propostas (menor = melhor).
const PRIORIDADES = [
  [/ata[\s_-]*final|ata[\s_-]*da[\s_-]*sess|ata[\s_-]*de[\s_-]*(julgamento|abertura|realiza)|ata[\s_-]*(do|de)[\s_-]*preg|ata[\s_-]*de[\s_-]*licita/i, 1],
  [/mapa[\s_-]*(de[\s_-]*)?(lances|apura|compara)|relat[oó]rio[\s_-]*de[\s_-]*(disputa|lances|julgamento)|classifica[cç][aã]o/i, 2],
  [/adjudica|julgamento|resultado|homologa/i, 3],
  [/ata[\s_-]*parcial/i, 4],
  [/^ata\b|[\s_-]ata[\s_.-]/i, 5],
];
function prioridade(a) {
  const nome = `${a.titulo ?? ''} ${a.tipoDocumentoNome ?? ''}`;
  if (/edital|minuta|termo de refer|estudo t[eé]cnico|aviso de|etp\b/i.test(a.tipoDocumentoNome ?? '') && !/ata|adjudica|homologa|resultado/i.test(a.titulo ?? '')) return null;
  if (/ata de registro de pre[cç]o/i.test(nome)) return 6; // traz o vencedor e a marca, mas não os demais
  for (const [re, p] of PRIORIDADES) if (re.test(nome)) return p;
  return null;
}

/** Documentos da compra no PNCP que podem ser a ata da sessão, do melhor para o pior. */
export async function candidatosAta(controle, { fetchImpl = fetch } = {}) {
  const m = String(controle ?? '').match(PARTES);
  if (!m) return [];
  const r = await fetchImpl(`${pncpApi()}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/arquivos`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404 || r.status === 204) return [];
  if (!r.ok) throw httpError(502, `O PNCP não respondeu agora (${r.status}). Tente de novo em alguns minutos.`);
  const lista = await r.json();
  return (Array.isArray(lista) ? lista : [])
    .map((a) => ({ titulo: a.titulo, tipo: a.tipoDocumentoNome, url: a.url ?? a.uri, prioridade: prioridade(a) }))
    .filter((a) => a.prioridade != null && a.url)
    .sort((a, b) => a.prioridade - b.prioridade);
}

const Proposta = z.object({
  fornecedor: z.string(),
  cnpj: z.string().nullable().describe('CNPJ ou CPF como aparece no documento, ou null'),
  marca: z.string().nullable(),
  modelo: z.string().nullable(),
  valor_unitario: z.number().nullable().describe('Valor unitário final (último lance ou proposta) em reais'),
  valor_total: z.number().nullable(),
  classificacao: z.number().int().nullable().describe('Posição: 1 para o primeiro colocado'),
  situacao: z.string().nullable().describe('Como o documento diz: vencedor, arrematante, aceito, habilitado, desclassificado, inabilitado, classificado...'),
  motivo: z.string().nullable().describe('Motivo de desclassificação/inabilitação, se houver'),
});
export const AtaSchema = z.object({
  tem_propostas: z.boolean().describe('true se o documento lista propostas ou lances de licitantes'),
  itens: z.array(z.object({
    numero: z.string().describe('Número do item ou lote como no documento (ex.: "1", "0001", "Lote 2")'),
    descricao: z.string(),
    propostas: z.array(Proposta),
  })),
  observacao: z.string().nullable().describe('Algo importante que não coube acima (ex.: documento só traz o vencedor)'),
});

const SISTEMA = `Você extrai dados de atas de sessão de licitações públicas brasileiras (pregão, dispensa, concorrência).
Copie os dados exatamente como estão no documento, sem inventar. Liste, para cada item ou lote, TODOS os licitantes
que aparecem (propostas enviadas, lances, classificação), com marca, modelo, valor final e situação.
Se o mesmo licitante aparece em várias seções (proposta, lance, classificação), junte numa só linha com o valor final.
Se o documento tiver mais de 80 itens, traga os 80 primeiros e diga isso na observação.`;

/** Lê a ata (com cache). Devolve { ata, arquivo, candidatos } ou { semAta: true }. */
export async function lerAta(db, uid, controle, { client, fetchImpl = fetch, somenteCache = false } = {}) {
  const salvo = db.prepare('SELECT arquivo, dados, criado_em FROM atas_lidas WHERE compra_controle = ?').get(controle);
  if (salvo) return { ata: JSON.parse(salvo.dados), arquivo: salvo.arquivo, lidoEm: salvo.criado_em };
  const candidatos = await candidatosAta(controle, { fetchImpl });
  if (!candidatos.length) return { semAta: true, candidatos: [] };
  if (somenteCache) return { candidatos };
  if (!client) throw httpError(503, 'A leitura com IA não está configurada no servidor (falta ANTHROPIC_API_KEY).');
  checarLimite(db, uid);

  // Baixa o melhor candidato que tenha conteúdo legível.
  for (const c of candidatos.slice(0, 3)) {
    const r = await fetchImpl(c.url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    const { partes } = expandirArquivo(c.titulo ?? 'ata', buf);
    let paginas = 0;
    const usar = partes.filter((p) => {
      if (p.tipo === 'pdf') { if (paginas + (p.paginas ?? 1) > MAX_PAGINAS_ATA) return false; paginas += p.paginas ?? 1; }
      return true;
    }).slice(0, 4);
    if (!usar.length) continue;
    const blocos = usar.map((p) => (p.tipo === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.bytes.toString('base64') }, title: p.nome }
      : { type: 'document', source: { type: 'text', media_type: 'text/plain', data: p.texto.slice(0, 300000) }, title: p.nome }));
    const resp = await client.beta.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      ...FALLBACK,
      system: SISTEMA,
      output_config: { effort: 'low', format: betaZodOutputFormat(AtaSchema) },
      messages: [{ role: 'user', content: [...blocos, { type: 'text', text: 'Extraia os licitantes de cada item desta ata.' }] }],
    });
    registrarUso(db, uid, 'ata', resp.usage, { modelo: resp.model ?? MODELO, referencia: `ata:${controle}` });
    if (resp.stop_reason === 'refusal' || !resp.parsed_output) continue;
    if (!resp.parsed_output.tem_propostas && c !== candidatos.at(-1)) continue; // não era a ata: tenta o próximo
    db.prepare('INSERT OR REPLACE INTO atas_lidas (compra_controle, arquivo, dados, modelo) VALUES (?, ?, ?, ?)')
      .run(controle, c.titulo ?? null, JSON.stringify(resp.parsed_output), resp.model ?? MODELO);
    return { ata: resp.parsed_output, arquivo: c.titulo, lidoEm: new Date().toISOString() };
  }
  return { semAta: true, candidatos, aviso: 'Encontramos documentos, mas nenhum trazia as propostas dos licitantes.' };
}
