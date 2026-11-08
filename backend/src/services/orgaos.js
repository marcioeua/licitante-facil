// Órgãos públicos: quem compra, quanto compra, de quem compra e se o ente costuma pagar em dia.
// Fontes: contratos e licitações do PNCP guardados no sistema + nota CAPAG do Tesouro (Pagômetro).
import { tx } from '../db/index.js';
import { pagometroDaOportunidade } from './capag.js';

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const so = (t) => String(t ?? '').replace(/\D/g, '');
const AGORA_LOCAL = "strftime('%Y-%m-%dT%H:%M:%S','now','localtime')";
const NOMES_ESFERA = { M: 'Municipal', E: 'Estadual', D: 'Distrital', F: 'Federal', N: 'Não informada' };

/** Recalcula o resumo dos órgãos (últimos 12 meses). */
export function atualizarOrgaos(db) {
  const desde = db.prepare("SELECT date('now', '-365 days') AS d").get().d;
  return tx(db, () => {
    db.prepare('DELETE FROM orgaos').run();
    db.prepare(`INSERT INTO orgaos (cnpj, nome, esfera, uf, municipio, codigo_ibge, contratos_12m, valor_12m, ultima_compra)
      SELECT orgao_cnpj, max(orgao_nome), max(esfera), max(uf), max(municipio), max(codigo_ibge), count(*), coalesce(sum(valor_global), 0), max(data_assinatura)
      FROM contratos WHERE orgao_cnpj IS NOT NULL AND orgao_nome IS NOT NULL AND data_publicacao >= ? GROUP BY orgao_cnpj`).run(desde);
    db.prepare(`INSERT INTO orgaos (cnpj, nome, esfera, uf, municipio, codigo_ibge, licitacoes_12m)
      SELECT orgao_cnpj, max(orgao_nome), max(esfera), max(uf), max(municipio), max(codigo_ibge), count(*)
      FROM oportunidades WHERE orgao_cnpj IS NOT NULL AND orgao_nome IS NOT NULL AND data_publicacao >= ? GROUP BY orgao_cnpj
      ON CONFLICT(cnpj) DO UPDATE SET licitacoes_12m = excluded.licitacoes_12m,
        esfera = coalesce(orgaos.esfera, excluded.esfera), codigo_ibge = coalesce(orgaos.codigo_ibge, excluded.codigo_ibge),
        municipio = coalesce(orgaos.municipio, excluded.municipio), uf = coalesce(orgaos.uf, excluded.uf)`).run(desde);
    const upd = db.prepare('UPDATE orgaos SET nome_norm = ? WHERE cnpj = ?');
    for (const o of db.prepare('SELECT cnpj, nome FROM orgaos').all()) upd.run(norm(o.nome), o.cnpj);
    return db.prepare('SELECT count(*) AS n FROM orgaos').get().n;
  });
}

/** A que ente o órgão pertence (município, estado, União) e se ele é o próprio ente. */
export function enteDoOrgao(o) {
  const nome = norm(o.nome);
  let ente = null;
  if (o.esfera === 'M') ente = o.municipio ? `Município de ${o.municipio}/${o.uf}` : 'Município';
  else if (o.esfera === 'E') ente = `Estado (${o.uf})`;
  else if (o.esfera === 'D') ente = 'Distrito Federal';
  else if (o.esfera === 'F') ente = 'Governo Federal (União)';
  const proprio = /^(municipio|prefeitura|estado d|governo do estado|distrito federal|uniao)/.test(nome);
  return { ente, proprioEnte: !!ente && proprio };
}

function comPagometro(db, o) {
  const p = pagometroDaOportunidade(db, { esfera: o.esfera, codigo_ibge: o.codigo_ibge, uf: o.uf, municipio: o.municipio, orgao_nome: o.nome });
  return { nivel: p.nivel, nota: p.capag ?? null, ente: p.ente?.nome ?? null, texto: p.texto, observacao: p.observacao ?? null };
}

export function listarOrgaos(db, { q, uf, esfera, pagina = 1 } = {}) {
  if (!db.prepare('SELECT 1 FROM orgaos LIMIT 1').get()) atualizarOrgaos(db);
  const where = [];
  const p = {};
  const termo = norm(q);
  if (termo) {
    const dig = so(q);
    if (dig.length >= 4) { where.push('(cnpj LIKE :cnpj OR nome_norm LIKE :q)'); p.cnpj = `${dig}%`; } else where.push('nome_norm LIKE :q');
    p.q = `%${termo}%`;
  }
  if (/^[A-Za-z]{2}$/.test(uf ?? '')) { where.push('uf = :uf'); p.uf = uf.toUpperCase(); }
  if (['M', 'E', 'D', 'F'].includes(esfera)) { where.push('esfera = :esf'); p.esf = esfera; }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT count(*) AS n FROM orgaos ${w}`).get(p).n;
  const tamanho = 20;
  const pg = Math.max(1, Number(pagina) || 1);
  const itens = db.prepare(`SELECT * FROM orgaos ${w} ORDER BY valor_12m DESC, licitacoes_12m DESC LIMIT ${tamanho} OFFSET ${(pg - 1) * tamanho}`).all(p);
  const abertas = db.prepare(`SELECT count(*) AS n FROM oportunidades WHERE orgao_cnpj = ? AND data_encerramento IS NOT NULL AND data_encerramento >= ${AGORA_LOCAL}`);
  return {
    total, pagina: pg, tamanho,
    atualizado: db.prepare('SELECT max(atualizado_em) AS d FROM orgaos').get().d,
    itens: itens.map((o) => ({
      cnpj: o.cnpj, nome: o.nome, esfera: o.esfera, esferaNome: NOMES_ESFERA[o.esfera] ?? null, uf: o.uf, municipio: o.municipio,
      ...enteDoOrgao(o), contratos12m: o.contratos_12m, valor12m: o.valor_12m, licitacoes12m: o.licitacoes_12m, ultimaCompra: o.ultima_compra,
      abertas: abertas.get(o.cnpj).n, pagometro: comPagometro(db, o),
    })),
  };
}

/** Órgãos das licitações que o usuário acompanha. */
export function orgaosDosNegocios(db, uid) {
  return db.prepare(`SELECT o.orgao_cnpj AS cnpj, max(o.orgao_nome) AS nome, count(*) AS negocios FROM negocios n JOIN oportunidades o ON o.id = n.oportunidade_id
    WHERE n.usuario_id = ? AND n.arquivado = 0 AND o.orgao_cnpj IS NOT NULL GROUP BY o.orgao_cnpj ORDER BY negocios DESC, nome LIMIT 12`).all(uid);
}

/** Página do órgão: resumo, Pagômetro, licitações abertas, contratos, fornecedores e compras por mês. */
export function perfilOrgao(db, cnpjEntrada) {
  const cnpj = so(cnpjEntrada);
  let o = db.prepare('SELECT * FROM orgaos WHERE cnpj = ?').get(cnpj);
  if (!o) {
    // Órgão sem compras nos últimos 12 meses: monta o básico a partir do que houver.
    o = db.prepare(`SELECT orgao_cnpj AS cnpj, max(orgao_nome) AS nome, max(esfera) AS esfera, max(uf) AS uf, max(municipio) AS municipio, max(codigo_ibge) AS codigo_ibge
      FROM (SELECT orgao_cnpj, orgao_nome, esfera, uf, municipio, codigo_ibge FROM contratos WHERE orgao_cnpj = :c
            UNION ALL SELECT orgao_cnpj, orgao_nome, esfera, uf, municipio, codigo_ibge FROM oportunidades WHERE orgao_cnpj = :c)`).get({ c: cnpj });
    if (!o?.nome) return null;
    Object.assign(o, { contratos_12m: 0, valor_12m: 0, licitacoes_12m: 0 });
  }
  const desde = db.prepare("SELECT date('now', '-365 days') AS d").get().d;
  const abertas = db.prepare(`SELECT id, objeto, modalidade, valor_estimado, data_encerramento, unidade_nome, municipio, uf FROM oportunidades
    WHERE orgao_cnpj = ? AND data_encerramento IS NOT NULL AND data_encerramento >= ${AGORA_LOCAL} ORDER BY data_encerramento LIMIT 30`).all(cnpj);
  const fornecedores = db.prepare(`SELECT fornecedor_ni AS ni, max(fornecedor_nome) AS nome, count(*) AS contratos, sum(valor_global) AS valor, max(data_assinatura) AS ultima
    FROM contratos WHERE orgao_cnpj = ? AND data_publicacao >= ? AND fornecedor_ni IS NOT NULL GROUP BY fornecedor_ni ORDER BY valor DESC LIMIT 10`).all(cnpj, desde);
  const recentes = db.prepare(`SELECT id, objeto, valor_global, fornecedor_ni, fornecedor_nome, data_assinatura, numero_controle_pncp, compra_controle
    FROM contratos WHERE orgao_cnpj = ? ORDER BY data_assinatura DESC LIMIT 15`).all(cnpj);
  const porMes = db.prepare(`SELECT substr(data_assinatura, 1, 7) AS mes, count(*) AS contratos, sum(valor_global) AS valor
    FROM contratos WHERE orgao_cnpj = ? AND data_publicacao >= ? AND data_assinatura IS NOT NULL GROUP BY mes ORDER BY mes`).all(cnpj, desde);
  return {
    cnpj, nome: o.nome, esfera: o.esfera, esferaNome: NOMES_ESFERA[o.esfera] ?? null, uf: o.uf, municipio: o.municipio, ...enteDoOrgao(o),
    resumo: { abertas: abertas.length, licitacoes12m: o.licitacoes_12m, contratos12m: o.contratos_12m, valor12m: o.valor_12m, fornecedores: fornecedores.length },
    pagometro: comPagometro(db, o), abertas, fornecedores, recentes, porMes,
  };
}
