// Análise de empresas fornecedoras: perfil de vendas ao governo (contratos do PNCP),
// clientes com Pagômetro, concorrentes diretos e dados cadastrais públicos (BrasilAPI / Receita Federal).

import { nivelRisco } from './capag.js';
import { analisarMercado } from './mercado.js';

const BRASILAPI = process.env.BRASILAPI_URL ?? 'https://brasilapi.com.br/api/cnpj/v1';
const so = (v) => String(v ?? '').replace(/\D/g, '');
const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Palavras comuns em objetos de contrato que não dizem o que a empresa vende.
const PARADAS = new Set(('aquisicao contratacao empresa especializada prestacao servicos servico fornecimento registro precos preco '
  + 'futura futuras eventual eventuais atender atendimento necessidades secretaria municipal municipio estadual conforme termo '
  + 'referencia edital anexo objeto destinados destinado destinadas uso para pela pelo com sem dos das nos nas que por sob '
  + 'demanda demandas diversas diversos material materiais tipo item itens lote lotes contrato processo pregao eletronico '
  + 'administrativo licitacao periodo meses mes ano anos unidade unidades geral gerais publica publico prefeitura fundo '
  + 'saude educacao departamento rede escolas manutencao contratada contratante visando visa').split(' '));

export function sugerirEmpresas(db, q = '', limite = 10) {
  const digitos = so(q);
  if (digitos.length >= 3) {
    return db.prepare(`SELECT fornecedor_ni AS ni, max(fornecedor_nome) AS nome, count(*) AS contratos, sum(valor_global) AS valor
      FROM contratos WHERE fornecedor_ni LIKE ? GROUP BY fornecedor_ni ORDER BY contratos DESC LIMIT ?`).all(`${digitos}%`, limite);
  }
  const termos = norm(q).match(/[a-z0-9]{2,}/g);
  if (!termos) return [];
  return db.prepare(`SELECT c.fornecedor_ni AS ni, max(c.fornecedor_nome) AS nome, count(*) AS contratos, sum(c.valor_global) AS valor
    FROM contratos_fts f JOIN contratos c ON c.id = f.rowid
    WHERE contratos_fts MATCH ? AND c.fornecedor_ni IS NOT NULL
    GROUP BY c.fornecedor_ni ORDER BY contratos DESC LIMIT ?`)
    .all(`fornecedor_nome : (${termos.map((t) => `"${t}"*`).join(' ')})`, limite);
}

/** Dados cadastrais públicos (Receita Federal via BrasilAPI), guardados por 30 dias. */
export async function cadastroCnpj(db, cnpj, { fetchImpl = fetch } = {}) {
  const c = so(cnpj);
  if (c.length !== 14) return null;
  const salvo = db.prepare("SELECT dados FROM empresas_cadastro WHERE cnpj = ? AND atualizado_em > datetime('now', '-30 days')").get(c);
  if (salvo) return JSON.parse(salvo.dados);
  try {
    const res = await fetchImpl(`${BRASILAPI}/${c}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const d = await res.json();
    const dados = {
      razaoSocial: d.razao_social ?? null,
      nomeFantasia: d.nome_fantasia || null,
      porte: d.porte ?? d.descricao_porte ?? null,
      simples: d.opcao_pelo_simples ?? null,
      mei: d.opcao_pelo_mei ?? null,
      atividade: d.cnae_fiscal_descricao ?? null,
      cnae: d.cnae_fiscal ? String(d.cnae_fiscal) : null,
      naturezaJuridica: d.natureza_juridica ?? null,
      situacao: d.descricao_situacao_cadastral ?? null,
      abertura: d.data_inicio_atividade ?? null,
      capitalSocial: d.capital_social ?? null,
      municipio: d.municipio ?? null,
      uf: d.uf ?? null,
      socios: (d.qsa ?? []).slice(0, 10).map((s) => ({ nome: s.nome_socio, qualificacao: s.qualificacao_socio })),
    };
    db.prepare("INSERT OR REPLACE INTO empresas_cadastro (cnpj, dados, atualizado_em) VALUES (?, ?, datetime('now'))").run(c, JSON.stringify(dados));
    return dados;
  } catch {
    return null; // sem internet ou serviço fora: o perfil segue sem cadastro
  }
}

function periodo(q) {
  const where = [];
  const p = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.de ?? '')) { where.push('c.data_publicacao >= :de'); p.de = q.de; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.ate ?? '')) { where.push('c.data_publicacao < :ate'); p.ate = `${q.ate}T99`; }
  return { cond: where.length ? ' AND ' + where.join(' AND ') : '', p };
}

/** Principais assuntos do que a empresa vende, pelas palavras mais frequentes nos objetos. */
function assuntos(db, cnpj, per) {
  const objetos = db.prepare(`SELECT c.objeto, c.valor_global FROM contratos c WHERE c.fornecedor_ni = :ni AND c.valor_global > 0 ${per.cond}
    ORDER BY c.data_publicacao DESC LIMIT 2000`).all({ ...per.p, ni: cnpj });
  const cont = new Map();
  for (const o of objetos) {
    const vistas = new Set(norm(o.objeto).match(/[a-z]{4,}/g)?.filter((w) => !PARADAS.has(w)) ?? []);
    for (const w of vistas) {
      const x = cont.get(w) ?? { termo: w, contratos: 0, valor: 0 };
      x.contratos++;
      x.valor += o.valor_global;
      cont.set(w, x);
    }
  }
  return [...cont.values()].filter((x) => x.contratos >= Math.min(2, objetos.length)).sort((a, b) => b.contratos - a.contratos || b.valor - a.valor).slice(0, 12);
}

export async function perfilEmpresa(db, ni, q = {}, { fetchImpl } = {}) {
  const cnpj = so(ni);
  const per = periodo(q);
  const p = { ...per.p, ni: cnpj };
  const base = `FROM contratos c WHERE c.fornecedor_ni = :ni AND c.valor_global > 0 ${per.cond}`;
  const r = db.prepare(`SELECT count(*) AS contratos, coalesce(sum(c.valor_global), 0) AS valor, count(DISTINCT c.orgao_cnpj) AS clientes,
    count(DISTINCT c.uf) AS estados, min(c.data_assinatura) AS primeira, max(c.data_assinatura) AS ultima, max(c.fornecedor_nome) AS nome ${base}`).get(p);
  const mercado = analisarMercado(db, { fornecedor: cnpj, de: q.de, ate: q.ate });

  // Clientes com o Pagômetro de cada órgão (CAPAG do município ou do estado).
  const clientes = db.prepare(`SELECT c.orgao_cnpj AS cnpj, max(c.orgao_nome) AS nome, max(c.uf) AS uf, max(c.municipio) AS municipio,
      max(c.esfera) AS esfera, max(c.codigo_ibge) AS codigo_ibge, count(*) AS contratos, sum(c.valor_global) AS valor, max(c.data_assinatura) AS ultima
    ${base} GROUP BY c.orgao_cnpj ORDER BY valor DESC LIMIT 15`).all(p)
    .map((o) => {
      let capag = null;
      if (o.esfera === 'M' && o.codigo_ibge) capag = db.prepare("SELECT capag, nota3 FROM capag_entes WHERE tipo = 'municipio' AND codigo = ?").get(o.codigo_ibge);
      else if ((o.esfera === 'E' || o.esfera === 'D') && o.uf) capag = db.prepare("SELECT capag, nota3 FROM capag_entes WHERE tipo = 'estado' AND codigo = ?").get(o.uf);
      return { ...o, participacao: r.valor ? o.valor / r.valor : 0, pagometro: o.esfera === 'F' ? 'federal' : capag ? nivelRisco(capag) : null };
    });
  const riscoClientes = clientes.reduce((acc, c) => (c.pagometro ? ((acc[c.pagometro] = (acc[c.pagometro] ?? 0) + c.valor), acc) : acc), {});

  // Concorrentes diretos: outras empresas que venderam para os mesmos clientes no período.
  const concorrentes = db.prepare(`WITH meus AS (SELECT DISTINCT c.orgao_cnpj ${base})
    SELECT c.fornecedor_ni AS ni, max(c.fornecedor_nome) AS nome, count(DISTINCT c.orgao_cnpj) AS clientesEmComum,
      count(*) AS contratos, sum(c.valor_global) AS valor
    FROM contratos c JOIN meus m ON m.orgao_cnpj = c.orgao_cnpj
    WHERE c.fornecedor_ni IS NOT NULL AND c.fornecedor_ni != :ni AND c.valor_global > 0 ${per.cond}
    GROUP BY c.fornecedor_ni ORDER BY clientesEmComum DESC, valor DESC LIMIT 10`).all(p);

  // Itens vencidos com preço unitário (das compras já consultadas na pesquisa de preços).
  const itens = db.prepare(`SELECT ci.descricao, ci.unidade, r.quantidade, r.valor_unitario, r.data_resultado, r.porte,
      (SELECT max(orgao_nome) FROM contratos x WHERE x.compra_controle = r.compra_controle) AS orgao
    FROM item_resultados r JOIN compra_itens ci ON ci.compra_controle = r.compra_controle AND ci.numero_item = r.numero_item
    WHERE r.fornecedor_ni = :ni ORDER BY r.data_resultado DESC LIMIT 30`).all({ ni: cnpj });

  const recentes = db.prepare(`SELECT c.id, c.objeto, c.valor_global, c.orgao_nome, c.uf, c.municipio, c.data_assinatura ${base}
    ORDER BY c.data_assinatura DESC LIMIT 20`).all(p);

  return {
    cnpj,
    nome: r.nome ?? db.prepare('SELECT max(fornecedor_nome) AS n FROM contratos WHERE fornecedor_ni = ?').get(cnpj)?.n ?? null,
    cadastro: await cadastroCnpj(db, cnpj, { fetchImpl }),
    resumo: { ...r, ticketMediano: mercado.resumo.ticketMediano, ticketMedio: r.contratos ? r.valor / r.contratos : 0 },
    porMes: mercado.porMes, porUf: mercado.porUf, porEsfera: mercado.porEsfera, porCategoria: mercado.porCategoria,
    assuntos: assuntos(db, cnpj, per),
    clientes, riscoClientes, concorrentes, itens, recentes,
    periodo: mercado.periodo,
  };
}

/** Compara duas ou mais empresas lado a lado (números principais). */
export function compararEmpresas(db, cnpjs, q = {}) {
  const per = periodo(q);
  return cnpjs.map(so).filter((c) => c.length >= 11).slice(0, 4).map((ni) => {
    const r = db.prepare(`SELECT max(c.fornecedor_nome) AS nome, count(*) AS contratos, coalesce(sum(c.valor_global), 0) AS valor,
      count(DISTINCT c.orgao_cnpj) AS clientes, count(DISTINCT c.uf) AS estados
      FROM contratos c WHERE c.fornecedor_ni = :ni AND c.valor_global > 0 ${per.cond}`).get({ ...per.p, ni });
    return { cnpj: ni, ...r, ticketMedio: r.contratos ? r.valor / r.contratos : 0 };
  });
}


