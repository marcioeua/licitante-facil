// Cliente da API pública de consultas do PNCP (Portal Nacional de Contratações Públicas).
// Documentação: https://pncp.gov.br/api/consulta/swagger-ui/index.html
import { config } from '../config.js';
import { tx } from '../db/index.js';

export const MODALIDADES = {
  1: 'Leilão - Eletrônico',
  2: 'Diálogo Competitivo',
  3: 'Concurso',
  4: 'Concorrência - Eletrônica',
  5: 'Concorrência - Presencial',
  6: 'Pregão - Eletrônico',
  7: 'Pregão - Presencial',
  8: 'Dispensa de Licitação',
  9: 'Inexigibilidade',
  10: 'Manifestação de Interesse',
  11: 'Pré-qualificação',
  12: 'Credenciamento',
  13: 'Leilão - Presencial',
};

/** Modalidades em que empresas normalmente enviam proposta. */
export const MODALIDADES_PADRAO = [4, 5, 6, 7, 8, 12];

const PAGE_SIZE = 50;

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

async function fetchJson(url, { fetchImpl = fetch, tentativas = 6, log = console.log } = {}) {
  for (let i = 1; ; i++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    } catch (e) {
      // Falha de rede ou timeout: tenta de novo com espera crescente.
      if (i >= tentativas) throw new Error(`Sem resposta do PNCP (${e.cause?.code ?? e.message}) para ${url}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    if (res.status === 204) return null; // PNCP responde 204 quando não há registros
    if (res.ok) return res.json();
    if (res.status === 429 && i < tentativas) {
      // Limite de requisições do PNCP: espera o tempo pedido (ou 30s) e tenta de novo.
      const espera = Number(res.headers.get('retry-after')) || 30;
      log(`PNCP pediu para aguardar ${espera}s (limite de requisições)...`);
      await new Promise((r) => setTimeout(r, espera * 1000));
      continue;
    }
    if (i >= tentativas || res.status < 500) {
      throw new Error(`PNCP respondeu ${res.status} para ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

/** Converte um registro de contratação do PNCP para o formato da tabela oportunidades. */
export function mapContratacao(c) {
  const cnpj = c.orgaoEntidade?.cnpj ?? null;
  const linkPncp =
    cnpj && c.anoCompra && c.sequencialCompra
      ? `https://pncp.gov.br/app/editais/${cnpj}/${c.anoCompra}/${c.sequencialCompra}`
      : null;
  return {
    numero_controle_pncp: c.numeroControlePNCP,
    objeto: (c.objetoCompra ?? '').trim(),
    modalidade_id: c.modalidadeId ?? null,
    modalidade: c.modalidadeNome ?? MODALIDADES[c.modalidadeId] ?? null,
    modo_disputa: c.modoDisputaNome ?? null,
    situacao: c.situacaoCompraNome ?? null,
    orgao_cnpj: cnpj,
    orgao_nome: c.orgaoEntidade?.razaoSocial ?? null,
    unidade_nome: c.unidadeOrgao?.nomeUnidade ?? null,
    uf: c.unidadeOrgao?.ufSigla ?? null,
    municipio: c.unidadeOrgao?.municipioNome ?? null,
    numero_compra: c.numeroCompra ?? null,
    ano_compra: c.anoCompra ?? null,
    sequencial_compra: c.sequencialCompra ?? null,
    valor_estimado: c.valorTotalEstimado ?? null,
    registro_preco: c.srp ? 1 : 0,
    data_publicacao: c.dataPublicacaoPncp ?? null,
    data_abertura: c.dataAberturaProposta ?? null,
    data_encerramento: c.dataEncerramentoProposta ?? null,
    link_origem: c.linkSistemaOrigem ?? null,
    link_pncp: linkPncp,
    esfera: c.orgaoEntidade?.esferaId ?? null,
    poder: c.orgaoEntidade?.poderId ?? null,
    codigo_ibge: c.unidadeOrgao?.codigoIbge ? String(c.unidadeOrgao.codigoIbge) : null,
  };
}

const COLS = [
  'numero_controle_pncp', 'objeto', 'modalidade_id', 'modalidade', 'modo_disputa', 'situacao',
  'orgao_cnpj', 'orgao_nome', 'unidade_nome', 'uf', 'municipio', 'numero_compra', 'ano_compra',
  'sequencial_compra', 'valor_estimado', 'registro_preco', 'data_publicacao', 'data_abertura',
  'data_encerramento', 'link_origem', 'link_pncp', 'esfera', 'poder', 'codigo_ibge',
];

/**
 * Grava/atualiza oportunidades. Com `soAbertasOuConhecidas`, ignora registros novos cujo prazo
 * de proposta já acabou (a consulta de atualizações traz também compras encerradas).
 */
export function upsertOportunidades(db, registros, { soAbertasOuConhecidas = false } = {}) {
  const stmt = db.prepare(`
    INSERT INTO oportunidades (${COLS.join(', ')})
    VALUES (${COLS.map((c) => ':' + c).join(', ')})
    ON CONFLICT(numero_controle_pncp) DO UPDATE SET
      ${COLS.filter((c) => c !== 'numero_controle_pncp').map((c) => `${c} = excluded.${c}`).join(', ')},
      atualizado_em = datetime('now')
  `);
  const existe = db.prepare('SELECT 1 FROM oportunidades WHERE numero_controle_pncp = ?');
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return tx(db, () => {
    let n = 0;
    for (const r of registros) {
      if (!r.numero_controle_pncp || !r.objeto) continue;
      if (soAbertasOuConhecidas && r.data_encerramento && r.data_encerramento < agora
        && !existe.get(r.numero_controle_pncp)) continue;
      stmt.run(r);
      n++;
    }
    return n;
  });
}

async function importarPaginas(db, { endpoint, parametros, tipo, modalidades, maxPaginas, pausaMs, fetchImpl, log, opcoesUpsert }) {
  const sync = db.prepare('INSERT INTO sincronizacoes (tipo) VALUES (?) RETURNING id').get(tipo);
  let total = 0;
  try {
    for (const modalidade of modalidades) {
      for (let pagina = 1; pagina <= maxPaginas; pagina++) {
        const url = new URL(`${config.pncpBaseUrl}/v1/contratacoes/${endpoint}`);
        url.search = new URLSearchParams({
          ...parametros,
          codigoModalidadeContratacao: String(modalidade),
          pagina: String(pagina),
          tamanhoPagina: String(PAGE_SIZE),
        });
        const body = await fetchJson(url, { fetchImpl, log });
        const itens = body?.data ?? [];
        total += upsertOportunidades(db, itens.map(mapContratacao), opcoesUpsert);
        log(`PNCP ${endpoint} modalidade ${modalidade} página ${pagina}: ${itens.length} registros`);
        if (!body || itens.length < PAGE_SIZE || (body.paginasRestantes ?? 0) <= 0) break;
        await new Promise((r) => setTimeout(r, pausaMs)); // evita sobrecarregar a API pública
      }
    }
    db.prepare("UPDATE sincronizacoes SET finalizado_em = datetime('now'), importadas = ? WHERE id = ?").run(total, sync.id);
    return { importadas: total };
  } catch (e) {
    db.prepare("UPDATE sincronizacoes SET finalizado_em = datetime('now'), importadas = ?, erro = ? WHERE id = ?")
      .run(total, String(e.message ?? e), sync.id);
    throw e;
  }
}

/**
 * Carga completa: contratações com recebimento de propostas em aberto
 * (GET /v1/contratacoes/proposta). Leva dezenas de minutos; rodar 1x por dia.
 */
export async function sincronizarPropostasAbertas(db, {
  modalidades = MODALIDADES_PADRAO, diasAFrente = 60, maxPaginas = 2000, pausaMs = 1000,
  fetchImpl = fetch, log = console.log,
} = {}) {
  return importarPaginas(db, {
    endpoint: 'proposta', tipo: 'completa',
    parametros: { dataFinal: yyyymmdd(new Date(Date.now() + diasAFrente * 86400000)) },
    modalidades, maxPaginas, pausaMs, fetchImpl, log,
  });
}

/**
 * Atualização incremental: compras alteradas desde `desde` (GET /v1/contratacoes/atualizacao).
 * Traz novas publicações e mudanças (datas, situação) das já conhecidas.
 */
export async function sincronizarAtualizacoes(db, {
  desde = new Date(Date.now() - 86400000), modalidades = MODALIDADES_PADRAO, maxPaginas = 400, pausaMs = 1000,
  fetchImpl = fetch, log = console.log,
} = {}) {
  return importarPaginas(db, {
    endpoint: 'atualizacao', tipo: 'incremental',
    parametros: { dataInicial: yyyymmdd(desde), dataFinal: yyyymmdd(new Date()) },
    modalidades, maxPaginas, pausaMs, fetchImpl, log, opcoesUpsert: { soAbertasOuConhecidas: true },
  });
}
