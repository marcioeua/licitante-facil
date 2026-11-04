// Histórico de compras: quem comprou, quem venceu e por quanto (dados abertos do PNCP).
// - Contratos: GET /api/consulta/v1/contratos (importados por data de publicação)
// - Itens e resultados: GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens[/{n}/resultados]
//   buscados sob demanda na pesquisa de preços e guardados para as próximas consultas.
import { config } from '../config.js';
import { tx } from '../db/index.js';
import { ftsQuery } from './busca.js';

const PAGE_SIZE = 50;
export const DIAS_HISTORICO = Number(process.env.HISTORICO_DIAS ?? 30);

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const yyyymmdd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const pncpApi = () => config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, fetchImpl, tentativas = 5) {
  for (let i = 1; ; i++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (i >= tentativas) throw new Error(`Sem resposta do PNCP (${e.cause?.code ?? e.message})`);
      await espera(1000 * 2 ** i);
      continue;
    }
    if (res.status === 204 || res.status === 404) return null;
    if (res.ok) return res.json();
    if (res.status === 429 && i < tentativas) {
      await espera((Number(res.headers.get('retry-after')) || 20) * 1000);
      continue;
    }
    if (i >= tentativas || res.status < 500) throw new Error(`PNCP respondeu ${res.status}`);
    await espera(1000 * 2 ** i);
  }
}

// ---------------- Contratos ----------------
export function mapContrato(c) {
  return {
    numero_controle_pncp: c.numeroControlePNCP,
    compra_controle: c.numeroControlePncpCompra ?? null,
    objeto: String(c.objetoContrato ?? '').trim().slice(0, 1500),
    categoria: c.categoriaProcesso?.nome ?? null,
    tipo: c.tipoContrato?.nome ?? null,
    valor_global: c.valorGlobal ?? c.valorInicial ?? null,
    fornecedor_ni: c.niFornecedor ?? null,
    fornecedor_nome: c.nomeRazaoSocialFornecedor ?? null,
    orgao_cnpj: c.orgaoEntidade?.cnpj ?? null,
    orgao_nome: c.orgaoEntidade?.razaoSocial ?? null,
    esfera: c.orgaoEntidade?.esferaId ?? null,
    unidade_nome: c.unidadeOrgao?.nomeUnidade ?? null,
    uf: c.unidadeOrgao?.ufSigla ?? null,
    municipio: c.unidadeOrgao?.municipioNome ?? null,
    codigo_ibge: c.unidadeOrgao?.codigoIbge ? String(c.unidadeOrgao.codigoIbge) : null,
    data_assinatura: c.dataAssinatura ?? null,
    data_publicacao: c.dataPublicacaoPncp ?? null,
  };
}

const COLS_CONTRATO = Object.keys(mapContrato({}));

export function gravarContratos(db, registros) {
  const st = db.prepare(`INSERT INTO contratos (${COLS_CONTRATO.join(', ')}) VALUES (${COLS_CONTRATO.map((c) => ':' + c).join(', ')})
    ON CONFLICT(numero_controle_pncp) DO UPDATE SET ${COLS_CONTRATO.slice(1).map((c) => `${c} = excluded.${c}`).join(', ')}`);
  return tx(db, () => {
    let n = 0;
    for (const r of registros) {
      if (!r.numero_controle_pncp || !r.objeto) continue;
      st.run(r);
      n++;
    }
    return n;
  });
}

/** Importa os contratos publicados em um dia (AAAA-MM-DD). */
export async function importarContratosDoDia(db, dia, { fetchImpl = fetch, pausaMs = 800, maxPaginas = 1000 } = {}) {
  const d = dia.replaceAll('-', '');
  let total = 0;
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${config.pncpBaseUrl}/v1/contratos?dataInicial=${d}&dataFinal=${d}&pagina=${pagina}&tamanhoPagina=${PAGE_SIZE}`;
    const body = await getJson(url, fetchImpl);
    const itens = body?.data ?? [];
    total += gravarContratos(db, itens.map(mapContrato));
    if (!body || itens.length < PAGE_SIZE || (body.paginasRestantes ?? 0) <= 0) break;
    await espera(pausaMs);
  }
  db.prepare('INSERT OR REPLACE INTO contratos_dias (dia, importados, importado_em) VALUES (?, ?, datetime(\'now\'))').run(dia, total);
  return total;
}

/** Próximo dia a importar: hoje/ontem primeiro (atualização), depois os dias passados até DIAS_HISTORICO. */
export function proximoDiaContratos(db, agora = new Date()) {
  const dia = (n) => new Date(agora.getTime() - n * 86400000).toISOString().slice(0, 10);
  const feito = db.prepare('SELECT importado_em FROM contratos_dias WHERE dia = ?');
  // Hoje e ontem são reimportados a cada 6 horas (chegam contratos novos ao longo do dia).
  for (const n of [1, 0]) {
    const r = feito.get(dia(n));
    if (!r || agora - new Date(r.importado_em.replace(' ', 'T') + 'Z') > 6 * 3600000) return dia(n);
  }
  for (let n = 2; n <= DIAS_HISTORICO; n++) if (!feito.get(dia(n))) return dia(n);
  return null;
}

/** Remove contratos e marcações mais antigos que o período guardado. */
export function limparHistoricoAntigo(db, agora = new Date()) {
  const limite = new Date(agora.getTime() - (DIAS_HISTORICO + 2) * 86400000).toISOString().slice(0, 10);
  const r = db.prepare('DELETE FROM contratos WHERE data_publicacao < ?').run(limite);
  db.prepare('DELETE FROM contratos_dias WHERE dia < ?').run(limite);
  return r.changes;
}

// ---------------- Consultas de contratos ----------------
function filtros(params, q) {
  const where = [];
  const p = {};
  let join = '';
  const fts = ftsQuery(q.q);
  if (fts) {
    join = 'JOIN contratos_fts f ON f.rowid = c.id';
    where.push('contratos_fts MATCH :fts');
    p.fts = fts;
  }
  if (/^[A-Za-z]{2}$/.test(q.uf ?? '')) { where.push('c.uf = :uf'); p.uf = q.uf.toUpperCase(); }
  if (q.municipio && String(q.municipio).includes(':')) {
    const [uf, nome] = String(q.municipio).split(':');
    where.push('c.uf = :muf AND c.municipio = :mnome COLLATE NOCASE');
    Object.assign(p, { muf: uf.toUpperCase(), mnome: nome });
  }
  if (q.fornecedor) { where.push('c.fornecedor_ni = :forn'); p.forn = String(q.fornecedor).replace(/\D/g, ''); }
  if (q.orgao) { where.push('c.orgao_cnpj = :org'); p.org = String(q.orgao).replace(/\D/g, ''); }
  return { join, where: where.length ? 'WHERE ' + where.join(' AND ') : '', p: { ...params, ...p } };
}

export function consultarContratos(db, q = {}) {
  const { join, where, p } = filtros({}, q);
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const tamanho = Math.min(100, Math.max(1, Number(q.tamanho) || 20));
  const base = `FROM contratos c ${join} ${where}`;
  const resumo = db.prepare(`SELECT count(*) AS total, sum(c.valor_global) AS valor_total FROM contratos c ${join} ${where}`).get(p);
  const itens = db.prepare(`SELECT c.* ${base} ORDER BY c.data_assinatura DESC, c.id DESC LIMIT :lim OFFSET :off`)
    .all({ ...p, lim: tamanho, off: (pagina - 1) * tamanho });
  const com = (cond) => `FROM contratos c ${join} ${where ? `${where} AND ${cond}` : `WHERE ${cond}`}`;
  const fornecedores = db.prepare(`SELECT c.fornecedor_ni AS ni, max(c.fornecedor_nome) AS nome, count(*) AS contratos, sum(c.valor_global) AS valor
    ${com('c.fornecedor_ni IS NOT NULL')} GROUP BY c.fornecedor_ni ORDER BY contratos DESC, valor DESC LIMIT 10`).all(p);
  const compradores = db.prepare(`SELECT c.orgao_cnpj AS cnpj, max(c.orgao_nome) AS nome, max(c.uf) AS uf, count(*) AS contratos, sum(c.valor_global) AS valor
    ${com('c.orgao_cnpj IS NOT NULL')} GROUP BY c.orgao_cnpj ORDER BY contratos DESC, valor DESC LIMIT 10`).all(p);
  const periodo = db.prepare('SELECT min(dia) AS de, max(dia) AS ate, count(*) AS dias FROM contratos_dias').get();
  return { total: resumo.total, valorTotal: resumo.valor_total ?? 0, pagina, tamanho, itens, fornecedores, compradores, periodo };
}

// ---------------- Pesquisa de preços (itens homologados) ----------------
function partesCompra(controle) {
  // "15126437000305-1-003899/2026" -> { cnpj, ano, seq }
  const m = String(controle ?? '').match(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/);
  return m ? { cnpj: m[1], seq: Number(m[2]), ano: Number(m[3]) } : null;
}

const temTodosOsTermos = (texto, termos) => {
  const t = norm(texto);
  return termos.every((x) => t.includes(x));
};

async function buscarItensDaCompra(db, controle, termos, { fetchImpl, maxResultados = 6 }) {
  const c = partesCompra(controle);
  if (!c) return 0;
  const base = `${pncpApi()}/v1/orgaos/${c.cnpj}/compras/${c.ano}/${c.seq}/itens`;
  const itens = (await getJson(`${base}?pagina=1&tamanhoPagina=500`, fetchImpl)) ?? [];
  const insItem = db.prepare(`INSERT INTO compra_itens (compra_controle, numero_item, descricao, unidade, quantidade, valor_unit_estimado, tem_resultado)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(compra_controle, numero_item) DO UPDATE SET descricao = excluded.descricao,
    unidade = excluded.unidade, quantidade = excluded.quantidade, valor_unit_estimado = excluded.valor_unit_estimado, tem_resultado = excluded.tem_resultado`);
  tx(db, () => {
    for (const it of itens) {
      insItem.run(controle, it.numeroItem, String(it.descricao ?? '').slice(0, 1000), it.unidadeMedida ?? null,
        it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.temResultado ? 1 : 0);
    }
    db.prepare("INSERT OR REPLACE INTO compras_consultadas (compra_controle, consultado_em) VALUES (?, datetime('now'))").run(controle);
  });
  let n = 0;
  const alvo = itens.filter((it) => it.temResultado && temTodosOsTermos(it.descricao, termos)).slice(0, maxResultados);
  const insRes = db.prepare(`INSERT OR REPLACE INTO item_resultados (compra_controle, numero_item, sequencial, fornecedor_ni, fornecedor_nome,
    porte, quantidade, valor_unitario, valor_total, data_resultado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const it of alvo) {
    const res = (await getJson(`${base}/${it.numeroItem}/resultados`, fetchImpl)) ?? [];
    tx(db, () => {
      for (const r of res) {
        if (r.dataCancelamento) continue;
        insRes.run(controle, it.numeroItem, r.sequencialResultado ?? 1, r.niFornecedor ?? null, r.nomeRazaoSocialFornecedor ?? null,
          r.porteFornecedorNome ?? null, r.quantidadeHomologada ?? null, r.valorUnitarioHomologado ?? null, r.valorTotalHomologado ?? null,
          r.dataResultado ?? null);
        n++;
      }
      db.prepare('UPDATE compra_itens SET resultado_buscado = 1 WHERE compra_controle = ? AND numero_item = ?').run(controle, it.numeroItem);
    });
  }
  return n;
}

function mediana(v) {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Pesquisa de preços: itens homologados cuja descrição contém os termos.
 * Consulta no PNCP até `maxCompras` compras novas relacionadas (pelos contratos) e guarda tudo.
 */
export async function pesquisarPrecos(db, q = {}, { fetchImpl = fetch, maxCompras = 12, concorrencia = 3 } = {}) {
  const termos = norm(q.q).match(/[a-z0-9]+/g)?.filter((t) => t.length > 1) ?? [];
  if (!termos.length) return { termos: [], grupos: [], itens: [], consultadas: 0 };
  const fts = ftsQuery(q.q);
  // Contratos descrevem o objeto de forma geral ("medicamentos"); o assunto ajuda a achar as compras.
  const p = { fts: ftsQuery(q.assunto) ?? fts, lim: maxCompras };
  let filtroLocal = '';
  if (/^[A-Za-z]{2}$/.test(q.uf ?? '')) { filtroLocal = 'AND c.uf = :uf'; p.uf = q.uf.toUpperCase(); }
  // Compras com contrato que ainda não foram consultadas item a item.
  const novas = db.prepare(`SELECT DISTINCT c.compra_controle FROM contratos_fts f JOIN contratos c ON c.id = f.rowid
    LEFT JOIN compras_consultadas cc ON cc.compra_controle = c.compra_controle
    WHERE contratos_fts MATCH :fts AND c.compra_controle IS NOT NULL AND cc.compra_controle IS NULL ${filtroLocal}
    ORDER BY c.data_assinatura DESC LIMIT :lim`).all(p).map((r) => r.compra_controle);
  let falhas = 0;
  for (let i = 0; i < novas.length; i += concorrencia) {
    const lote = novas.slice(i, i + concorrencia);
    const r = await Promise.allSettled(lote.map((c) => buscarItensDaCompra(db, c, termos, { fetchImpl })));
    falhas += r.filter((x) => x.status === 'rejected').length;
  }
  // Itens já guardados que combinam, mas cujo resultado ainda não foi buscado (de pesquisas anteriores).
  const pendentes = db.prepare(`SELECT ci.compra_controle, ci.numero_item, ci.descricao FROM compra_itens_fts f
    JOIN compra_itens ci ON ci.id = f.rowid
    WHERE compra_itens_fts MATCH :fts AND ci.tem_resultado = 1 AND ci.resultado_buscado = 0 LIMIT 60`).all({ fts })
    .filter((it) => temTodosOsTermos(it.descricao, termos));
  const porCompra = Map.groupBy(pendentes, (x) => x.compra_controle);
  for (const [controle] of porCompra) {
    try { await buscarItensDaCompra(db, controle, termos, { fetchImpl }); } catch { falhas++; }
  }

  const linhas = db.prepare(`SELECT ci.descricao, ci.unidade, ci.valor_unit_estimado, r.*, c.orgao_nome, c.uf, c.municipio
    FROM compra_itens_fts f
    JOIN compra_itens ci ON ci.id = f.rowid
    JOIN item_resultados r ON r.compra_controle = ci.compra_controle AND r.numero_item = ci.numero_item
    LEFT JOIN (SELECT compra_controle, max(orgao_nome) AS orgao_nome, max(uf) AS uf, max(municipio) AS municipio FROM contratos GROUP BY compra_controle) c
      ON c.compra_controle = r.compra_controle
    WHERE compra_itens_fts MATCH :fts ORDER BY r.data_resultado DESC LIMIT 2000`).all({ fts })
    .filter((l) => temTodosOsTermos(l.descricao, termos) && l.valor_unitario > 0)
    .filter((l) => !p.uf || l.uf === p.uf);

  // Estatísticas por unidade de medida (comparar "unidade" com "caixa" não faz sentido).
  const grupos = [...Map.groupBy(linhas, (l) => (l.unidade ?? 'Não informada').trim())]
    .map(([unidade, ls]) => {
      const v = ls.map((l) => l.valor_unitario);
      return { unidade, quantidade: ls.length, minimo: Math.min(...v), mediana: mediana(v), media: v.reduce((a, b) => a + b, 0) / v.length, maximo: Math.max(...v) };
    })
    .sort((a, b) => b.quantidade - a.quantidade);
  const link = (controle) => {
    const c = partesCompra(controle);
    return c ? `https://pncp.gov.br/app/editais/${c.cnpj}/${c.ano}/${c.seq}` : null;
  };
  return {
    termos,
    consultadas: novas.length,
    falhas,
    grupos,
    itens: linhas.slice(0, 100).map((l) => ({
      descricao: l.descricao, unidade: l.unidade, quantidade: l.quantidade, valorUnitario: l.valor_unitario,
      valorEstimado: l.valor_unit_estimado, fornecedor: l.fornecedor_nome, fornecedorNi: l.fornecedor_ni, porte: l.porte,
      orgao: l.orgao_nome, uf: l.uf, municipio: l.municipio, data: l.data_resultado, link: link(l.compra_controle),
    })),
  };
}
