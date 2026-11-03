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

async function fetchJson(url, { fetchImpl = fetch, tentativas = 3 } = {}) {
  for (let i = 1; ; i++) {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (res.status === 204) return null; // PNCP responde 204 quando não há registros
    if (res.ok) return res.json();
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
  };
}

const COLS = [
  'numero_controle_pncp', 'objeto', 'modalidade_id', 'modalidade', 'modo_disputa', 'situacao',
  'orgao_cnpj', 'orgao_nome', 'unidade_nome', 'uf', 'municipio', 'numero_compra', 'ano_compra',
  'sequencial_compra', 'valor_estimado', 'registro_preco', 'data_publicacao', 'data_abertura',
  'data_encerramento', 'link_origem', 'link_pncp',
];

export function upsertOportunidades(db, registros) {
  const stmt = db.prepare(`
    INSERT INTO oportunidades (${COLS.join(', ')})
    VALUES (${COLS.map((c) => ':' + c).join(', ')})
    ON CONFLICT(numero_controle_pncp) DO UPDATE SET
      ${COLS.filter((c) => c !== 'numero_controle_pncp').map((c) => `${c} = excluded.${c}`).join(', ')},
      atualizado_em = datetime('now')
  `);
  return tx(db, () => {
    let n = 0;
    for (const r of registros) {
      if (!r.numero_controle_pncp || !r.objeto) continue;
      stmt.run(r);
      n++;
    }
    return n;
  });
}

/**
 * Importa contratações com recebimento de propostas em aberto.
 * Usa GET /v1/contratacoes/proposta, que lista compras cujo prazo de proposta
 * ainda não terminou até `dataFinal`.
 */
export async function sincronizarPropostasAbertas(db, {
  modalidades = MODALIDADES_PADRAO,
  diasAFrente = 60,
  maxPaginas = 40,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const sync = db.prepare('INSERT INTO sincronizacoes DEFAULT VALUES RETURNING id').get();
  const dataFinal = yyyymmdd(new Date(Date.now() + diasAFrente * 86400000));
  let total = 0;
  try {
    for (const modalidade of modalidades) {
      for (let pagina = 1; pagina <= maxPaginas; pagina++) {
        const url = new URL(`${config.pncpBaseUrl}/v1/contratacoes/proposta`);
        url.search = new URLSearchParams({
          dataFinal,
          codigoModalidadeContratacao: String(modalidade),
          pagina: String(pagina),
          tamanhoPagina: String(PAGE_SIZE),
        });
        const body = await fetchJson(url, { fetchImpl });
        const itens = body?.data ?? [];
        total += upsertOportunidades(db, itens.map(mapContratacao));
        log(`PNCP modalidade ${modalidade} página ${pagina}: ${itens.length} registros`);
        if (!body || itens.length < PAGE_SIZE || (body.paginasRestantes ?? 0) <= 0) break;
      }
    }
    db.prepare("UPDATE sincronizacoes SET finalizado_em = datetime('now'), importadas = ? WHERE id = ?")
      .run(total, sync.id);
    return { importadas: total };
  } catch (e) {
    db.prepare("UPDATE sincronizacoes SET finalizado_em = datetime('now'), importadas = ?, erro = ? WHERE id = ?")
      .run(total, String(e.message ?? e), sync.id);
    throw e;
  }
}
