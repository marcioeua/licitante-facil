// Leitura de editais com IA (Claude): resumo estruturado e perguntas com citação de páginas.
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { tx } from '../db/index.js';
import { httpError } from '../http.js';
import { baixarArquivosEdital, selecionarPartes } from './editalArquivos.js';

export const MODELO = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
const LIMITE_DIARIO = Number(process.env.IA_LIMITE_DIARIO ?? 30);
const VALIDADE_ARQUIVOS_DIAS = 30;
// Se o modelo recusar por política de segurança, a API refaz a chamada em outro modelo.
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

const SISTEMA = `Você é um analista de licitações públicas brasileiras, experiente na Lei 14.133/2021, \
ajudando uma empresa que avalia se vai participar desta licitação.
Use somente os documentos fornecidos. Se uma informação não estiver neles, diga que não encontrou \
em vez de supor. Escreva em português do Brasil, de forma direta e prática. \
Indique o item ou a página do edital sempre que possível.`;

const textoOuNulo = z.string().nullable();
export const ResumoSchema = z.object({
  objeto: z.string().describe('O que está sendo contratado, em uma frase'),
  resumo: z.string().describe('Visão geral em 3 a 5 frases para quem vai decidir se participa'),
  orgao: textoOuNulo,
  modalidade: textoOuNulo,
  criterio_julgamento: textoOuNulo.describe('Ex.: menor preço por item, por lote, maior desconto'),
  modo_disputa: textoOuNulo,
  data_sessao: textoOuNulo.describe('Data e hora da sessão/abertura, como está no edital'),
  local_disputa: textoOuNulo.describe('Portal ou sistema onde ocorre a disputa (ex.: Compras.gov.br, BEC/SP)'),
  prazo_impugnacao: textoOuNulo,
  valor_estimado: textoOuNulo.describe('Valor total estimado, ou "sigiloso" se o edital disser'),
  exclusivo_me_epp: textoOuNulo.describe('Se há exclusividade ou cota para ME/EPP e em quais itens'),
  itens_principais: z.array(z.object({
    descricao: z.string(),
    quantidade: textoOuNulo,
    valor_estimado: textoOuNulo,
  })).describe('Até 15 itens ou lotes mais relevantes'),
  documentos_habilitacao: z.array(z.object({
    grupo: z.enum(['juridica', 'fiscal_trabalhista', 'economico_financeira', 'tecnica', 'outros']),
    descricao: z.string(),
  })).describe('Documentos exigidos para habilitação'),
  qualificacao_tecnica: z.object({
    exige_atestado: z.enum(['sim', 'nao', 'nao_informado']).describe('O edital exige atestado de capacidade técnica (ou comprovação de experiência anterior) para habilitação? Use "nao_informado" se o edital não deixar claro'),
    detalhe: textoOuNulo.describe('O que exatamente é exigido (quantidade mínima, parcela relevante etc.) ou o trecho que dispensa, com item/página'),
  }).describe('Qualificação técnica exigida na habilitação'),
  requisitos_proposta: z.array(z.string()).describe('O que a proposta precisa conter (amostras, catálogos, prazos de validade etc.)'),
  prazo_entrega_execucao: textoOuNulo,
  condicoes_pagamento: textoOuNulo,
  garantias: textoOuNulo.describe('Garantia de proposta, contratual ou do produto'),
  vigencia: textoOuNulo.describe('Vigência do contrato ou da ata de registro de preços'),
  penalidades: textoOuNulo,
  pontos_atencao: z.array(z.string()).describe('Exigências incomuns, riscos ou prazos apertados que a empresa não pode perder'),
});

export function clienteIA() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new Anthropic();
}

/** Traduz falhas externas (PNCP, API da Anthropic) em mensagens claras para o usuário. */
export async function comMensagensClaras(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.expose || (e.statusCode && e.statusCode < 500)) throw e;
    if (e instanceof Anthropic.RateLimitError) throw httpError(503, 'A IA está ocupada no momento. Tente de novo em 1 minuto.');
    if (e instanceof Anthropic.AuthenticationError) throw httpError(503, 'A chave da IA (ANTHROPIC_API_KEY) é inválida. Avise o administrador.');
    if (e instanceof Anthropic.BadRequestError) throw httpError(422, 'A IA não conseguiu ler este edital (arquivo muito grande ou em formato não suportado).');
    if (e instanceof Anthropic.APIError) throw httpError(502, 'A IA não respondeu agora. Tente novamente em instantes.');
    if (/PNCP|fetch failed|timeout|aborted/i.test(e.message ?? '')) throw httpError(502, 'Não foi possível baixar o edital do PNCP agora. Tente novamente em instantes.');
    throw e;
  }
}

function exigirCliente(client) {
  if (!client) throw httpError(503, 'A leitura com IA não está configurada no servidor (falta ANTHROPIC_API_KEY).');
  return client;
}

export function checarLimite(db, uid) {
  const { n } = db.prepare("SELECT count(*) AS n FROM ia_uso WHERE usuario_id = ? AND criado_em >= datetime('now', 'start of day')").get(uid);
  if (n >= LIMITE_DIARIO) throw httpError(429, `Você atingiu o limite de ${LIMITE_DIARIO} análises com IA por dia. Tente amanhã.`);
}

export function registrarUso(db, uid, tipo, usage) {
  db.prepare('INSERT INTO ia_uso (usuario_id, tipo, input_tokens, output_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?)')
    .run(uid, tipo, usage?.input_tokens ?? null, usage?.output_tokens ?? null, usage?.cache_read_input_tokens ?? null);
}

// Evita baixar/analisar o mesmo edital duas vezes ao mesmo tempo.
const emAndamento = new Map();
function umaVez(chave, fn) {
  if (!emAndamento.has(chave)) {
    emAndamento.set(chave, fn().finally(() => emAndamento.delete(chave)));
  }
  return emAndamento.get(chave);
}

/** Garante que os arquivos do edital estão na Files API; devolve as linhas de edital_arquivos. */
export async function prepararEdital(db, op, { client, fetchImpl = fetch } = {}) {
  const validos = () => db.prepare(
    "SELECT * FROM edital_arquivos WHERE oportunidade_id = ? AND expira_em > datetime('now') ORDER BY ordem",
  ).all(op.id);
  const existentes = validos();
  if (existentes.length) return existentes;
  exigirCliente(client);

  return umaVez(`arquivos:${op.id}`, async () => {
    const { partes, ignorados } = await baixarArquivosEdital(op, { fetchImpl });
    const { escolhidas, ignorados: foraDoLimite } = selecionarPartes(partes);
    const enviados = [];
    for (const p of escolhidas) {
      const conteudo = p.tipo === 'pdf' ? p.bytes : Buffer.from(p.texto, 'utf8');
      const nomeArquivo = p.tipo === 'pdf' ? p.nome.replace(/(\.pdf)?$/i, '.pdf') : `${p.nome}.txt`;
      const meta = await client.files.upload({
        file: await toFile(conteudo, nomeArquivo, { type: p.tipo === 'pdf' ? 'application/pdf' : 'text/plain' }),
        expires_in_seconds: VALIDADE_ARQUIVOS_DIAS * 86400,
      });
      enviados.push({ ...p, file_id: meta.id, tamanho: conteudo.length });
    }
    tx(db, () => {
      db.prepare('DELETE FROM edital_arquivos WHERE oportunidade_id = ?').run(op.id);
      db.prepare('DELETE FROM edital_ignorados WHERE oportunidade_id = ?').run(op.id);
      const ins = db.prepare(`INSERT INTO edital_arquivos (oportunidade_id, ordem, nome, tipo, file_id, paginas, tamanho, expira_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
      // Expira um dia antes do arquivo na Anthropic, para nunca usar um file_id vencido.
      enviados.forEach((p, i) => ins.run(op.id, i, p.nome, p.tipo, p.file_id, p.paginas ?? null, p.tamanho, `+${VALIDADE_ARQUIVOS_DIAS - 1} days`));
      const insIg = db.prepare('INSERT INTO edital_ignorados (oportunidade_id, nome, motivo) VALUES (?, ?, ?)');
      [...ignorados, ...foraDoLimite].forEach((g) => insIg.run(op.id, g.nome, g.motivo));
    });
    const linhas = validos();
    if (!linhas.length) {
      throw httpError(422, 'Não encontramos o edital em PDF ou Word no PNCP para esta licitação. Abra o edital pelo link do PNCP.');
    }
    return linhas;
  });
}

function blocosDocumentos(arquivos, { citacoes }) {
  return arquivos.map((a, i) => ({
    type: 'document',
    source: { type: 'file', file_id: a.file_id },
    title: a.nome,
    citations: { enabled: citacoes },
    // Os documentos vêm primeiro e não mudam: ficam em cache entre as perguntas.
    ...(i === arquivos.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

function checarRecusa(resp) {
  if (resp.stop_reason === 'refusal') {
    throw httpError(422, 'A IA não conseguiu analisar este documento. Tente uma pergunta diferente.');
  }
}

export function infoArquivos(db, opId) {
  return {
    arquivos: db.prepare("SELECT nome, tipo, paginas FROM edital_arquivos WHERE oportunidade_id = ? AND expira_em > datetime('now') ORDER BY ordem").all(opId),
    ignorados: db.prepare('SELECT nome, motivo FROM edital_ignorados WHERE oportunidade_id = ?').all(opId),
  };
}

/** Resumo estruturado do edital (gerado uma vez e compartilhado entre usuários). */
export async function resumirEdital(db, op, uid, { client, fetchImpl } = {}) {
  const salvo = db.prepare('SELECT resumo, modelo, criado_em FROM edital_resumos WHERE oportunidade_id = ?').get(op.id);
  if (salvo) return { ...salvo, resumo: JSON.parse(salvo.resumo), ...infoArquivos(db, op.id) };
  exigirCliente(client);
  checarLimite(db, uid);

  return umaVez(`resumo:${op.id}`, async () => {
    const arquivos = await prepararEdital(db, op, { client, fetchImpl });
    const resp = await client.beta.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      ...FALLBACK,
      system: SISTEMA,
      output_config: { effort: 'medium', format: betaZodOutputFormat(ResumoSchema) },
      messages: [{
        role: 'user',
        content: [
          ...blocosDocumentos(arquivos, { citacoes: false }),
          { type: 'text', text: 'Faça o resumo deste edital para uma empresa que está avaliando participar.' },
        ],
      }],
    });
    registrarUso(db, uid, 'resumo', resp.usage);
    checarRecusa(resp);
    if (!resp.parsed_output) throw httpError(502, 'A IA não devolveu um resumo válido. Tente novamente.');
    db.prepare('INSERT OR REPLACE INTO edital_resumos (oportunidade_id, resumo, modelo) VALUES (?, ?, ?)')
      .run(op.id, JSON.stringify(resp.parsed_output), resp.model ?? MODELO);
    return { resumo: resp.parsed_output, modelo: resp.model ?? MODELO, criado_em: new Date().toISOString(), ...infoArquivos(db, op.id) };
  });
}

/** Converte a resposta (com citações) em texto + lista de trechos citados. */
export function extrairResposta(content) {
  let texto = '';
  const citacoes = [];
  const vistas = new Set();
  for (const b of content) {
    if (b.type !== 'text') continue;
    texto += b.text;
    for (const c of b.citations ?? []) {
      const pag = c.type === 'page_location'
        ? (c.start_page_number === c.end_page_number - 1 || c.end_page_number == null
          ? `p. ${c.start_page_number}` : `p. ${c.start_page_number}–${c.end_page_number - 1}`)
        : null;
      const chave = `${c.document_index}:${c.start_page_number ?? c.start_char_index}:${c.cited_text?.slice(0, 40)}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      citacoes.push({ documento: c.document_title ?? null, pagina: pag, trecho: (c.cited_text ?? '').trim().slice(0, 500) });
      texto += ` [${citacoes.length}]`;
    }
  }
  return { texto: texto.trim(), citacoes };
}

export function historico(db, opId, uid) {
  return db.prepare('SELECT id, pergunta, resposta, citacoes, criado_em FROM edital_perguntas WHERE oportunidade_id = ? AND usuario_id = ? ORDER BY id')
    .all(opId, uid).map((p) => ({ ...p, citacoes: JSON.parse(p.citacoes) }));
}

/** Pergunta livre sobre o edital, com as respostas anteriores do usuário como contexto. */
export async function perguntarEdital(db, op, uid, pergunta, { client, fetchImpl } = {}) {
  exigirCliente(client);
  checarLimite(db, uid);
  const arquivos = await prepararEdital(db, op, { client, fetchImpl });
  const anteriores = historico(db, op.id, uid).slice(-6);

  const docs = blocosDocumentos(arquivos, { citacoes: true });
  const messages = [];
  const perguntas = [...anteriores.map((a) => a.pergunta), pergunta];
  perguntas.forEach((p, i) => {
    messages.push({ role: 'user', content: i === 0 ? [...docs, { type: 'text', text: p }] : p });
    if (i < anteriores.length) messages.push({ role: 'assistant', content: anteriores[i].resposta });
  });

  const resp = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    ...FALLBACK,
    system: SISTEMA,
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
    messages,
  });
  registrarUso(db, uid, 'pergunta', resp.usage);
  checarRecusa(resp);
  const { texto, citacoes } = extrairResposta(resp.content);
  if (!texto) throw httpError(502, 'A IA não devolveu resposta. Tente novamente.');
  return db.prepare(`INSERT INTO edital_perguntas (oportunidade_id, usuario_id, pergunta, resposta, citacoes)
    VALUES (?, ?, ?, ?, ?) RETURNING id, pergunta, resposta, citacoes, criado_em`)
    .get(op.id, uid, pergunta, texto, JSON.stringify(citacoes));
}

/**
 * Exigência de atestado de capacidade técnica a partir do resumo do edital.
 * Só afirma "exige" ou "não exige" quando o edital foi lido pela IA.
 */
export function exigenciaAtestado(resumo) {
  if (!resumo) return { situacao: 'nao_verificado', detalhe: 'Edital ainda não lido pela IA.' };
  const q = resumo.qualificacao_tecnica;
  if (q?.exige_atestado === 'sim') return { situacao: 'exige', detalhe: q.detalhe ?? null };
  if (q?.exige_atestado === 'nao') return { situacao: 'nao_exige', detalhe: q.detalhe ?? null };
  const docs = (resumo.documentos_habilitacao ?? []).filter((d) => /atestado|capacidade t[eé]cnica|acervo t[eé]cnico/i.test(d.descricao));
  if (docs.length) return { situacao: 'exige', detalhe: docs.map((d) => d.descricao).join('; ') };
  if (q?.exige_atestado === 'nao_informado') return { situacao: 'nao_informado', detalhe: q.detalhe ?? 'O edital não deixa claro.' };
  return { situacao: 'nao_listado', detalhe: 'A IA leu o edital e não listou atestado entre os documentos de habilitação.' };
}
