// Marca dos produtos vencidos, com dados abertos oficiais do Compras.gov.br:
// 1) itens da compra (código do catálogo CATMAT e id da compra);
// 2) pesquisa de preço do material, que traz a marca declarada pelo fornecedor vencedor.
// Só existe para compras feitas no Compras.gov.br com item de catálogo; outros portais não publicam a marca.
import { tx } from '../db/index.js';

const DADOS_ABERTOS = process.env.DADOS_ABERTOS_URL ?? 'https://dadosabertos.compras.gov.br';
const so = (v) => String(v ?? '').replace(/\D/g, '');
const emAndamento = new Set();
const falhas = new Map();

async function json(fetchImpl, url, timeoutMs) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (r.status === 404 || r.status === 204) return { resultado: [] };
  if (!r.ok) throw new Error(`Compras.gov.br ${r.status}`);
  return r.json();
}

/** Consulta as marcas de uma compra para os itens que o fornecedor `ni` venceu (e guarda as dos demais vencedores). */
async function marcasDaCompra(db, controle, itensDoFornecedor, ni, fetchImpl, timeoutMs) {
  const lista = (await json(fetchImpl, `${DADOS_ABERTOS}/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id?tipo=numeroControlePNCPCompra&codigo=${encodeURIComponent(controle)}`, timeoutMs)).resultado ?? [];
  // Aproveita para guardar a descrição do item quando o PNCP ainda não respondeu.
  const insItem = db.prepare(`INSERT INTO compra_itens (compra_controle, numero_item, descricao, unidade, quantidade, valor_unit_estimado, tem_resultado, situacao, criterio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(compra_controle, numero_item) DO NOTHING`);
  tx(db, () => {
    for (const it of lista) {
      const desc = String(it.descricaodetalhada || it.descricaoResumida || '').replace(/\s+/g, ' ').trim();
      if (desc) insItem.run(controle, it.numeroItemPncp, desc.slice(0, 1000), it.unidadeMedida ?? null, it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.temResultado ? 1 : 0, it.situacaoCompraItemNome ?? null, it.criterioJulgamentoNome ?? null);
    }
  });
  const ins = db.prepare('INSERT OR REPLACE INTO marcas_itens (compra_controle, numero_item, fornecedor_ni, marca) VALUES (?, ?, ?, ?)');
  let achou = 0;
  for (const numero of itensDoFornecedor) {
    const it = lista.find((x) => x.numeroItemPncp === numero);
    if (!it?.codItemCatalogo || !it.idCompra) continue;
    const linhas = (await json(fetchImpl, `${DADOS_ABERTOS}/modulo-pesquisa-preco/1_consultarMaterial?tipo=codigoItemCatalogo&codigo=${it.codItemCatalogo}&idCompra=${it.idCompra}&tamanhoPagina=50`, timeoutMs)).resultado ?? [];
    const doItem = linhas.filter((l) => Number(l.numeroItemCompra) === Number(it.numeroItemCompra));
    tx(db, () => {
      for (const l of doItem) {
        const marca = String(l.marca ?? '').trim() || null;
        ins.run(controle, numero, so(l.niFornecedor), marca);
        if (marca && so(l.niFornecedor) === ni) achou++;
      }
      if (!doItem.some((l) => so(l.niFornecedor) === ni)) ins.run(controle, numero, ni, null);
    });
  }
  db.prepare("INSERT OR REPLACE INTO marcas_compras (compra_controle, buscado_em, achou) VALUES (?, datetime('now'), ?)").run(controle, achou);
}

/**
 * Busca as marcas das vitórias do fornecedor, dentro de um orçamento de tempo.
 * Compras sem marca encontrada são consultadas de novo depois de 7 dias (a pesquisa de preço é atualizada com atraso).
 * Devolve quantas compras ficaram pendentes.
 */
export async function completarMarcas(db, ni, itens, fetchImpl = fetch, { orcamentoMs = 5000, maxCompras = 200 } = {}) {
  const cnpj = so(ni);
  const prazo = Date.now() + orcamentoMs;
  const porCompra = Map.groupBy(itens.filter((i) => i.compra), (i) => i.compra);
  const ja = db.prepare("SELECT 1 FROM marcas_compras WHERE compra_controle = ? AND (achou > 0 OR buscado_em > datetime('now', '-7 days'))");
  const faltando = [...porCompra.keys()].filter((c) => !ja.get(c) && !emAndamento.has(c) && !(falhas.get(c) > Date.now() - 3600000)).slice(0, maxCompras);
  let feitas = 0;
  for (let i = 0; i < faltando.length && Date.now() < prazo; i += 4) {
    const restante = Math.max(2000, Math.min(20000, prazo - Date.now()));
    await Promise.allSettled(faltando.slice(i, i + 4).map(async (c) => {
      emAndamento.add(c);
      try {
        await marcasDaCompra(db, c, [...new Set(porCompra.get(c).map((x) => x.item))], cnpj, fetchImpl, restante);
        feitas++;
      } catch {
        falhas.set(c, Date.now());
      } finally {
        emAndamento.delete(c);
      }
    }));
  }
  return Math.max(0, faltando.length - feitas);
}

/** Marca do item vencido por `ni` (ou null). */
export function marcaDoItem(db, compra, item, ni) {
  return db.prepare('SELECT marca FROM marcas_itens WHERE compra_controle = ? AND numero_item = ? AND fornecedor_ni = ?').get(compra, item, so(ni))?.marca ?? null;
}
