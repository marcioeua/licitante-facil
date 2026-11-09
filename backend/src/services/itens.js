// Busca por item: todos os itens das licitações publicadas (Lei 14.133) nos Dados Abertos do Compras.gov.br,
// com a situação do item (em andamento, homologado, deserto, fracassado, cancelado) e o vencedor quando há resultado.
// Os dados são guardados aos poucos pelo agendador (um dia por rodada) e pesquisados localmente.
import { tx } from '../db/index.js';
import { ftsQuery } from './busca.js';
import { podeCrescer } from './historico.js';
import { portalDoLink } from './portais.js';
import { config } from '../config.js';

const DADOS_ABERTOS = process.env.DADOS_ABERTOS_URL ?? 'https://dadosabertos.compras.gov.br';
export const DIAS_ITENS = Number(process.env.ITENS_DIAS ?? 90);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const so = (v) => String(v ?? '').replace(/\D/g, '');
const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;

async function getJson(url, fetchImpl, tentativas = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (r.status === 404 || r.status === 204) return { resultado: [] };
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`Compras.gov.br respondeu ${r.status}`), { final: true });
      if (i >= tentativas) throw new Error(`Compras.gov.br respondeu ${r.status}`);
    } catch (e) {
      if (e.final || i >= tentativas) throw e;
    }
    await espera(2000 * i);
  }
}

export function mapItem(r) {
  const desc = String(r.descricaodetalhada || r.descricaoResumida || '').replace(/\s+/g, ' ').trim();
  return {
    compra: r.numeroControlePNCPCompra ?? r.idContratacaoPNCP,
    numero: r.numeroItemPncp,
    descricao: desc.slice(0, 500),
    material: r.materialOuServico === 'M' ? 1 : r.materialOuServico === 'S' ? 0 : null,
    unidade: r.unidadeMedida ?? null,
    quantidade: r.quantidade ?? null,
    estimado: r.orcamentoSigiloso ? null : r.valorUnitarioEstimado ?? null,
    situacao: r.situacaoCompraItemNome ?? null,
    criterio: r.criterioJulgamentoNome ?? null,
    beneficio: r.tipoBeneficioNome ?? null,
    fornecedorNi: r.temResultado ? so(r.codFornecedor) || null : null,
    fornecedorNome: r.temResultado ? r.nomeFornecedor ?? null : null,
    valorResultado: r.temResultado ? r.valorUnitarioResultado ?? null : null,
    quantidadeResultado: r.temResultado ? r.quantidadeResultado ?? null : null,
    dataResultado: String(r.dataResultado ?? '').slice(0, 10) || null,
    dataInclusao: String(r.dataInclusaoPncp ?? '').slice(0, 19) || null,
    orgaoCnpj: r.orgaoEntidadeCnpj ?? null,
  };
}

export function gravarItens(db, itens) {
  const ins = db.prepare(`INSERT INTO itens_licitacao (compra_controle, numero_item, descricao, material, unidade, quantidade, valor_estimado, situacao, criterio, beneficio,
      fornecedor_ni, fornecedor_nome, valor_resultado, quantidade_resultado, data_resultado, data_inclusao, orgao_cnpj)
    VALUES (:compra, :numero, :descricao, :material, :unidade, :quantidade, :estimado, :situacao, :criterio, :beneficio,
      :fornecedorNi, :fornecedorNome, :valorResultado, :quantidadeResultado, :dataResultado, :dataInclusao, :orgaoCnpj)
    ON CONFLICT(compra_controle, numero_item) DO UPDATE SET descricao = excluded.descricao, situacao = excluded.situacao,
      fornecedor_ni = excluded.fornecedor_ni, fornecedor_nome = excluded.fornecedor_nome, valor_resultado = excluded.valor_resultado,
      quantidade_resultado = excluded.quantidade_resultado, data_resultado = excluded.data_resultado, valor_estimado = excluded.valor_estimado`);
  let n = 0;
  tx(db, () => {
    for (const i of itens) {
      if (!i.compra || i.numero == null || !i.descricao) continue;
      ins.run(i);
      n++;
    }
  });
  return n;
}

/** Importa os itens incluídos no PNCP em um dia (AAAA-MM-DD). */
export async function importarItensDoDia(db, dia, { fetchImpl = fetch, pausaMs = 300, maxPaginas = 200 } = {}) {
  let total = 0;
  // A data final da API não entra no resultado: pede do dia até o dia seguinte.
  const seguinte = new Date(new Date(`${dia}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${DADOS_ABERTOS}/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?pagina=${pagina}&tamanhoPagina=500`
      + `&dataInclusaoPncpInicial=${dia}&dataInclusaoPncpFinal=${seguinte}`;
    const d = await getJson(url, fetchImpl);
    total += gravarItens(db, (d.resultado ?? []).map(mapItem));
    if (!d.paginasRestantes || !(d.resultado ?? []).length) break;
    await espera(pausaMs);
  }
  db.prepare("INSERT OR REPLACE INTO itens_dias (dia, importados, importado_em) VALUES (?, ?, datetime('now'))").run(dia, total);
  return total;
}

/**
 * Próximo dia a importar: hoje e ontem a cada 6h; os últimos 45 dias de novo a cada 4 dias
 * (a situação e o vencedor dos itens mudam depois); depois os dias passados até DIAS_ITENS.
 */
export function proximoDiaItens(db, agora = new Date()) {
  const dia = (n) => new Date(agora.getTime() - n * 86400000).toISOString().slice(0, 10);
  const feito = db.prepare('SELECT importado_em FROM itens_dias WHERE dia = ?');
  const idade = (r) => agora - new Date(r.importado_em.replace(' ', 'T') + 'Z');
  for (const n of [1, 0]) {
    const r = feito.get(dia(n));
    if (!r || idade(r) > 6 * 3600000) return dia(n);
  }
  for (let n = 2; n <= Math.min(45, DIAS_ITENS); n++) {
    const r = feito.get(dia(n));
    if (r && idade(r) > 4 * 86400000) return dia(n);
  }
  if (!podeCrescer(db)) return null;
  for (let n = 2; n <= DIAS_ITENS; n++) if (!feito.get(dia(n))) return dia(n);
  return null;
}

export function limparItensAntigos(db, agora = new Date()) {
  const limite = new Date(agora.getTime() - (DIAS_ITENS + 2) * 86400000).toISOString().slice(0, 10);
  const r = db.prepare('DELETE FROM itens_licitacao WHERE data_inclusao < ?').run(limite);
  db.prepare('DELETE FROM itens_dias WHERE dia < ?').run(limite);
  db.prepare('DELETE FROM itens_compras WHERE controle NOT IN (SELECT DISTINCT compra_controle FROM itens_licitacao)').run();
  return r.changes;
}

/** Usa a licitação já guardada na base de oportunidades como cabeçalho (sem consultar nada). */
function cabecalhoDaOportunidade(db, controle) {
  const o = db.prepare('SELECT * FROM oportunidades WHERE numero_controle_pncp = ?').get(controle);
  if (!o) return false;
  db.prepare(`INSERT OR REPLACE INTO itens_compras (controle, orgao, unidade, municipio, uf, modalidade, numero, ano, abertura, encerramento, objeto, srp, link_origem, buscado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(controle, o.orgao_nome, o.unidade_nome, o.municipio, o.uf, o.modalidade,
    o.numero_compra, o.ano_compra, o.data_abertura, o.data_encerramento, String(o.objeto ?? '').slice(0, 500), o.registro_preco ? 1 : 0, o.link_origem);
  return true;
}

/**
 * Itens das licitações abertas guardadas na base (todos os portais), pelo PNCP.
 * Os Dados Abertos só trazem compras com cerca de 10 dias de atraso; assim as abertas agora também aparecem.
 */
export async function importarItensDasOportunidades(db, { fetchImpl = fetch, max = 150, concorrencia = 4, prazoMs = 120000 } = {}) {
  const fim = Date.now() + prazoMs;
  const agora = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19);
  const lista = db.prepare(`SELECT o.numero_controle_pncp AS c, o.data_publicacao FROM oportunidades o
    LEFT JOIN itens_pncp p ON p.controle = o.numero_controle_pncp
    WHERE o.data_encerramento > ? AND (p.controle IS NULL OR (p.itens = 0 AND p.buscado_em < datetime('now', '-1 day')))
    ORDER BY o.data_publicacao DESC LIMIT ?`).all(agora, max);
  const publicacao = new Map(lista.map((r) => [r.c, r.data_publicacao]));
  const pncp = config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');
  let feitas = 0;
  let falhas = 0;
  for (let i = 0; i < lista.length && Date.now() < fim && falhas < 6; i += concorrencia) {
    await Promise.allSettled(lista.slice(i, i + concorrencia).map(async ({ c: controle }) => {
      const m = controle.match(PARTES);
      if (!m) return;
      try {
        const r = await fetchImpl(`${pncp}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/itens?pagina=1&tamanhoPagina=500`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok && r.status !== 204 && r.status !== 404) throw new Error(`PNCP ${r.status}`);
        const lista2 = r.ok && r.status !== 204 ? await r.json() : [];
        const n = gravarItens(db, (Array.isArray(lista2) ? lista2 : []).map((it) => ({
          compra: controle, numero: it.numeroItem, descricao: String(it.descricao ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
          material: it.materialOuServico === 'M' ? 1 : it.materialOuServico === 'S' ? 0 : null, unidade: it.unidadeMedida ?? null,
          quantidade: it.quantidade ?? null, estimado: it.orcamentoSigiloso ? null : it.valorUnitarioEstimado ?? null,
          situacao: it.situacaoCompraItemNome ?? null, criterio: it.criterioJulgamentoNome ?? null, beneficio: it.tipoBeneficioNome ?? null,
          fornecedorNi: null, fornecedorNome: null, valorResultado: null, quantidadeResultado: null, dataResultado: null,
          dataInclusao: String(it.dataInclusao ?? publicacao.get(controle) ?? '').slice(0, 19) || null, orgaoCnpj: m[1],
        })));
        cabecalhoDaOportunidade(db, controle);
        db.prepare("INSERT OR REPLACE INTO itens_pncp (controle, itens, buscado_em) VALUES (?, ?, datetime('now'))").run(controle, n);
        feitas++;
      } catch {
        falhas++;
      }
    }));
  }
  return { feitas, falhas, fila: lista.length };
}

/** Busca o cabeçalho (órgão, UF, modalidade, datas) das compras que ainda não têm. */
export async function completarCabecalhos(db, { fetchImpl = fetch, max = 300, concorrencia = 4, compras = null } = {}) {
  const lista = compras ?? db.prepare(`SELECT DISTINCT i.compra_controle AS c FROM itens_licitacao i
    LEFT JOIN itens_compras ic ON ic.controle = i.compra_controle
    WHERE ic.controle IS NULL OR (ic.orgao IS NULL AND ic.buscado_em < datetime('now', '-7 days'))
    ORDER BY i.data_inclusao DESC LIMIT ?`).all(max).map((r) => r.c);
  const ins = db.prepare(`INSERT OR REPLACE INTO itens_compras (controle, orgao, unidade, municipio, uf, modalidade, numero, ano, abertura, encerramento, objeto, srp, buscado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
  let feitas = 0;
  const daBase = lista.filter((c) => cabecalhoDaOportunidade(db, c));
  feitas += daBase.length;
  const restantes = lista.filter((c) => !daBase.includes(c));
  for (let i = 0; i < restantes.length; i += concorrencia) {
    await Promise.allSettled(restantes.slice(i, i + concorrencia).map(async (controle) => {
      const d = await getJson(`${DADOS_ABERTOS}/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id?tipo=numeroControlePNCPCompra&codigo=${encodeURIComponent(controle)}`, fetchImpl, 2);
      const c = d.resultado?.[0];
      const m = controle.match(PARTES);
      ins.run(controle, c?.orgaoEntidadeRazaoSocial ?? null, c?.unidadeOrgaoNomeUnidade ?? null, c?.unidadeOrgaoMunicipioNome ?? null,
        c?.unidadeOrgaoUfSigla ?? null, c?.modalidadeNome ?? null, c?.numeroCompra ?? null, Number(c?.anoCompraPncp ?? m?.[3]) || null,
        c?.dataAberturaPropostaPncp ?? null, c?.dataEncerramentoPropostaPncp ?? null, String(c?.objetoCompra ?? '').slice(0, 500) || null,
        c ? (String(c.srp) === 'true' || String(c.srp) === 'True' ? 1 : 0) : null);
      feitas++;
    }));
  }
  return feitas;
}

const linkPncp = (controle) => {
  const m = String(controle ?? '').match(PARTES);
  return m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${m[2]}` : null;
};

/** Pesquisa itens por palavras, com filtros. */
export async function buscarItens(db, q = {}, { fetchImpl = fetch } = {}) {
  const fts = ftsQuery(q.q);
  if (!fts) return { total: 0, itens: [], pagina: 1, tamanho: 20 };
  const tamanho = 20;
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const where = ['itens_licitacao_fts MATCH :fts'];
  const p = { fts };
  if (/^[A-Za-z]{2}$/.test(q.uf ?? '')) { where.push('ic.uf = :uf'); p.uf = q.uf.toUpperCase(); }
  if (q.situacao === 'abertas') {
    where.push("i.situacao = 'Em andamento' AND ic.encerramento > :agora");
    p.agora = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19); // horário de Brasília
  } else if (q.situacao === 'homologados') where.push("i.situacao = 'Homologado'");
  else if (q.situacao === 'andamento') where.push("i.situacao = 'Em andamento'");
  else if (q.situacao === 'sem_sucesso') where.push("i.situacao IN ('Deserto', 'Fracassado', 'Anulado/Revogado/Cancelado')");
  if (q.tipo === 'material') where.push('i.material = 1');
  else if (q.tipo === 'servico') where.push('i.material = 0');
  const precisaCab = Boolean(p.uf || p.agora);
  const join = `FROM itens_licitacao_fts f JOIN itens_licitacao i ON i.id = f.rowid ${precisaCab ? '' : 'LEFT '}JOIN itens_compras ic ON ic.controle = i.compra_controle`;
  const total = db.prepare(`SELECT count(*) AS n ${join} WHERE ${where.join(' AND ')}`).get(p).n;
  const ordem = q.ordem === 'valor' ? 'coalesce(i.valor_estimado * i.quantidade, 0) DESC' : 'i.data_inclusao DESC';
  let linhas = db.prepare(`SELECT i.*, ic.buscado_em AS cab_buscado, ic.link_origem, ic.orgao, ic.unidade AS unidade_compradora, ic.municipio, ic.uf, ic.modalidade, ic.numero, ic.ano, ic.abertura, ic.encerramento, ic.objeto
    ${join} WHERE ${where.join(' AND ')} ORDER BY ${ordem} LIMIT :lim OFFSET :off`).all({ ...p, lim: tamanho, off: (pagina - 1) * tamanho });
  // Cabeçalho que ainda não foi buscado: busca agora só para os itens desta página.
  const faltam = [...new Set(linhas.filter((l) => !l.cab_buscado).map((l) => l.compra_controle))];
  if (faltam.length) {
    await Promise.race([completarCabecalhos(db, { fetchImpl, compras: faltam }).catch(() => {}), espera(8000)]);
    const cab = db.prepare('SELECT * FROM itens_compras WHERE controle = ?');
    linhas = linhas.map((l) => {
      const c = l.orgao ? null : cab.get(l.compra_controle);
      return c ? { ...l, link_origem: c.link_origem, orgao: c.orgao, unidade_compradora: c.unidade, municipio: c.municipio, uf: c.uf, modalidade: c.modalidade, numero: c.numero, ano: c.ano, abertura: c.abertura, encerramento: c.encerramento, objeto: c.objeto } : l;
    });
  }
  const marca = db.prepare('SELECT marca FROM marcas_itens WHERE compra_controle = ? AND numero_item = ? AND fornecedor_ni = ?');
  const op = db.prepare('SELECT id FROM oportunidades WHERE numero_controle_pncp = ?');
  const periodo = db.prepare('SELECT min(dia) AS de, count(*) AS dias FROM itens_dias').get();
  return {
    total, pagina, tamanho,
    periodo: { desde: periodo.de, dias: periodo.dias },
    itens: linhas.map((l) => ({
      compra: l.compra_controle, item: l.numero_item, descricao: l.descricao, material: l.material === 1,
      unidade: l.unidade, quantidade: l.quantidade, valorEstimado: l.valor_estimado, situacao: l.situacao, criterio: l.criterio, beneficio: l.beneficio,
      fornecedorNi: l.fornecedor_ni, fornecedorNome: l.fornecedor_nome, valorResultado: l.valor_resultado, quantidadeResultado: l.quantidade_resultado,
      dataResultado: l.data_resultado, marca: l.fornecedor_ni ? marca.get(l.compra_controle, l.numero_item, l.fornecedor_ni)?.marca ?? null : null,
      orgao: l.orgao, unidadeCompradora: l.unidade_compradora, municipio: l.municipio, uf: l.uf, modalidade: l.modalidade, numero: l.numero, ano: l.ano,
      abertura: l.abertura, encerramento: l.encerramento, objeto: l.objeto, publicacao: l.data_inclusao,
      portal: l.link_origem ? portalDoLink(l.link_origem) : 'Compras.gov.br', linkOrigem: l.link_origem ?? null,
      linkPncp: linkPncp(l.compra_controle), oportunidadeId: op.get(l.compra_controle)?.id ?? null,
    })),
  };
}
