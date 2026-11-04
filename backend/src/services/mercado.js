// Análise de mercado a partir dos contratos publicados no PNCP (tabela contratos).
import { ftsQuery } from './busca.js';

export const ESFERAS = { M: 'Municipal', E: 'Estadual', D: 'Distrital', F: 'Federal', N: 'Outros (estatais etc.)' };

function montarFiltro(q = {}) {
  const where = [];
  const p = {};
  let join = '';
  const fts = ftsQuery(q.q);
  if (fts) {
    join = 'JOIN contratos_fts f ON f.rowid = c.id';
    where.push('contratos_fts MATCH :fts');
    p.fts = fts;
  }
  const ufs = String(q.uf ?? '').split(',').map((u) => u.trim().toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u));
  if (ufs.length) {
    where.push(`c.uf IN (${ufs.map((_, i) => `:uf${i}`).join(',')})`);
    ufs.forEach((u, i) => (p[`uf${i}`] = u));
  }
  if (q.esfera && ESFERAS[q.esfera]) { where.push('c.esfera = :esf'); p.esf = q.esfera; }
  if (q.fornecedor) { where.push('c.fornecedor_ni = :forn'); p.forn = String(q.fornecedor).replace(/\D/g, ''); }
  if (q.orgao) { where.push('c.orgao_cnpj = :org'); p.org = String(q.orgao).replace(/\D/g, ''); }
  // Período pela data de publicação no PNCP (AAAA-MM-DD).
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.de ?? '')) { where.push('c.data_publicacao >= :de'); p.de = q.de; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.ate ?? '')) { where.push('c.data_publicacao < :ate'); p.ate = `${q.ate}T99`; }
  // Valores nulos/zerados não entram em somas de mercado.
  where.push('c.valor_global > 0');
  return { from: `FROM contratos c ${join} WHERE ${where.join(' AND ')}`, p };
}

function mediana(db, from, p, total) {
  if (!total) return null;
  const meio = Math.floor((total - 1) / 2);
  const vals = db.prepare(`SELECT c.valor_global AS v ${from} ORDER BY c.valor_global LIMIT :lim OFFSET :off`)
    .all({ ...p, lim: total % 2 ? 1 : 2, off: meio }).map((r) => r.v);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Visão de mercado de um segmento (busca por texto) e/ou região. */
export function analisarMercado(db, q = {}) {
  const { from, p } = montarFiltro(q);
  const r = db.prepare(`SELECT count(*) AS contratos, coalesce(sum(c.valor_global), 0) AS valor,
    count(DISTINCT c.fornecedor_ni) AS fornecedores, count(DISTINCT c.orgao_cnpj) AS compradores ${from}`).get(p);
  const total = r.valor || 0;
  const share = (v) => (total ? v / total : 0);

  const porSemana = db.prepare(`SELECT date(substr(c.data_publicacao, 1, 10), '-6 days', 'weekday 1') AS semana,
      count(*) AS contratos, sum(c.valor_global) AS valor
    ${from} AND c.data_publicacao IS NOT NULL GROUP BY semana ORDER BY semana`).all(p);
  // Meses recentes ainda recebem contratos publicados com atraso: marcados como "em consolidação".
  const limiteConsolidacao = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 7);
  const porMes = db.prepare(`SELECT substr(c.data_publicacao, 1, 7) AS mes, count(*) AS contratos, sum(c.valor_global) AS valor
    ${from} AND c.data_publicacao IS NOT NULL GROUP BY mes ORDER BY mes`).all(p)
    .map((x) => ({ ...x, consolidando: x.mes >= limiteConsolidacao }));
  const totais = db.prepare(`SELECT count(DISTINCT c.uf) AS estados, count(DISTINCT c.municipio || c.uf) AS municipios ${from}`).get(p);
  const porUf = db.prepare(`SELECT c.uf, count(*) AS contratos, sum(c.valor_global) AS valor
    ${from} AND c.uf IS NOT NULL GROUP BY c.uf ORDER BY valor DESC`).all(p);
  const porEsfera = db.prepare(`SELECT coalesce(c.esfera, 'N') AS esfera, count(*) AS contratos, sum(c.valor_global) AS valor
    ${from} GROUP BY 1 ORDER BY valor DESC, esfera`).all(p)
    .map((e) => ({ ...e, nome: ESFERAS[e.esfera] ?? 'Outros', participacao: share(e.valor) }));
  const porCategoria = db.prepare(`SELECT coalesce(c.categoria, 'Não informada') AS categoria, count(*) AS contratos, sum(c.valor_global) AS valor
    ${from} GROUP BY 1 ORDER BY valor DESC`).all(p).map((e) => ({ ...e, participacao: share(e.valor) }));
  const fornecedores = db.prepare(`SELECT c.fornecedor_ni AS ni, max(c.fornecedor_nome) AS nome, count(*) AS contratos,
      sum(c.valor_global) AS valor, count(DISTINCT c.orgao_cnpj) AS clientes, count(DISTINCT c.uf) AS ufs
    ${from} AND c.fornecedor_ni IS NOT NULL GROUP BY c.fornecedor_ni ORDER BY valor DESC LIMIT 15`).all(p)
    .map((f) => ({ ...f, participacao: share(f.valor), participacaoContratos: r.contratos ? f.contratos / r.contratos : 0 }));
  // Ranking por número de contratos (menos sensível a um único contrato gigante).
  const fornecedoresPorContratos = db.prepare(`SELECT c.fornecedor_ni AS ni, max(c.fornecedor_nome) AS nome, count(*) AS contratos,
      sum(c.valor_global) AS valor, count(DISTINCT c.orgao_cnpj) AS clientes, count(DISTINCT c.uf) AS ufs
    ${from} AND c.fornecedor_ni IS NOT NULL GROUP BY c.fornecedor_ni ORDER BY contratos DESC, valor DESC LIMIT 15`).all(p)
    .map((f) => ({ ...f, participacao: share(f.valor), participacaoContratos: r.contratos ? f.contratos / r.contratos : 0 }));
  const maior = db.prepare(`SELECT c.valor_global AS valor, c.fornecedor_nome AS fornecedor, c.orgao_nome AS orgao, c.objeto
    ${from} ORDER BY c.valor_global DESC LIMIT 1`).get(p);
  const compradores = db.prepare(`SELECT c.orgao_cnpj AS cnpj, max(c.orgao_nome) AS nome, max(c.uf) AS uf, max(c.esfera) AS esfera,
      count(*) AS contratos, sum(c.valor_global) AS valor
    ${from} AND c.orgao_cnpj IS NOT NULL GROUP BY c.orgao_cnpj ORDER BY valor DESC LIMIT 10`).all(p)
    .map((o) => ({ ...o, participacao: share(o.valor) }));

  const nivel = (x) => (!r.contratos ? null : x >= 0.6 ? 'alta' : x >= 0.3 ? 'media' : 'baixa');
  const top5 = fornecedores.slice(0, 5).reduce((a, f) => a + f.participacao, 0);
  const top5c = fornecedoresPorContratos.slice(0, 5).reduce((a, f) => a + f.participacaoContratos, 0);
  const concentracao = {
    porValor: { lider: fornecedores[0]?.participacao ?? 0, top5, nivel: nivel(top5) },
    porContratos: { lider: fornecedoresPorContratos[0]?.participacaoContratos ?? 0, top5: top5c, nivel: nivel(top5c) },
  };
  // Aviso quando um único contrato distorce as somas de valor.
  const contratoDominante = maior && total && maior.valor / total >= 0.3 && r.contratos > 3
    ? { ...maior, participacao: maior.valor / total, objeto: String(maior.objeto).slice(0, 200) } : null;
  const periodo = db.prepare('SELECT min(dia) AS de, max(dia) AS ate, count(*) AS dias FROM contratos_dias').get();
  return {
    resumo: {
      contratos: r.contratos, valor: total, ticketMedio: r.contratos ? total / r.contratos : 0,
      ticketMediano: mediana(db, from, p, r.contratos), fornecedores: r.fornecedores, compradores: r.compradores,
      estados: totais.estados, municipios: totais.municipios,
    },
    concentracao, contratoDominante, porSemana, porMes, porUf, porEsfera, porCategoria, fornecedores, fornecedoresPorContratos, compradores, periodo,
  };
}

/** Perfil de uma empresa fornecedora (concorrente ou a própria). */
export function analisarEmpresa(db, ni, q = {}) {
  const cnpj = String(ni ?? '').replace(/\D/g, '');
  const geral = analisarMercado(db, { ...q, fornecedor: cnpj });
  const { from, p } = montarFiltro({ ...q, fornecedor: cnpj });
  const nome = db.prepare('SELECT fornecedor_nome FROM contratos WHERE fornecedor_ni = ? LIMIT 1').get(cnpj)?.fornecedor_nome ?? null;
  const recentes = db.prepare(`SELECT c.id, c.objeto, c.valor_global, c.orgao_nome, c.uf, c.municipio, c.data_assinatura
    ${from} ORDER BY c.data_assinatura DESC LIMIT 20`).all(p);
  // Participação da empresa no mercado do mesmo segmento/região (sem o filtro de fornecedor).
  const mercado = q.q || q.uf ? analisarMercado(db, { ...q, fornecedor: undefined }).resumo.valor : null;
  return {
    ni: cnpj, nome,
    resumo: geral.resumo,
    participacaoNoMercado: mercado ? geral.resumo.valor / mercado : null,
    porSemana: geral.porSemana, porUf: geral.porUf, porEsfera: geral.porEsfera,
    clientes: geral.compradores, recentes, periodo: geral.periodo,
  };
}

const RANKINGS = {
  uf: { chave: 'c.uf', nome: 'c.uf', extra: "'' AS detalhe" },
  municipio: { chave: "c.municipio || '/' || c.uf", nome: "c.municipio || '/' || c.uf", extra: 'max(c.uf) AS detalhe' },
  orgao: { chave: 'c.orgao_cnpj', nome: 'max(c.orgao_nome)', extra: "max(c.uf) AS detalhe" },
  fornecedor: { chave: 'c.fornecedor_ni', nome: 'max(c.fornecedor_nome)', extra: 'count(DISTINCT c.orgao_cnpj) AS detalhe' },
  categoria: { chave: "coalesce(c.categoria, 'Não informada')", nome: "coalesce(c.categoria, 'Não informada')", extra: "'' AS detalhe" },
};

/** Ranking completo e paginado de um "ângulo de análise". */
export function rankingMercado(db, tipo, q = {}) {
  const def = RANKINGS[tipo];
  if (!def) return null;
  const { from, p } = montarFiltro(q);
  const ordem = q.ordem === 'contratos' ? 'contratos DESC, valor DESC' : 'valor DESC, contratos DESC';
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const tamanho = Math.min(100, Math.max(1, Number(q.tamanho) || 25));
  const base = `${from} AND ${def.chave} IS NOT NULL GROUP BY ${def.chave}`;
  const total = db.prepare(`SELECT count(*) AS n FROM (SELECT 1 ${base})`).get(p).n;
  const soma = db.prepare(`SELECT coalesce(sum(c.valor_global), 0) AS v ${from}`).get(p).v || 1;
  const itens = db.prepare(`SELECT ${def.chave} AS chave, ${def.nome} AS nome, ${def.extra}, count(*) AS contratos, sum(c.valor_global) AS valor
    ${base} ORDER BY ${ordem} LIMIT :lim OFFSET :off`).all({ ...p, lim: tamanho, off: (pagina - 1) * tamanho })
    .map((x) => ({ ...x, participacao: x.valor / soma }));
  return { tipo, total, pagina, tamanho, itens };
}
