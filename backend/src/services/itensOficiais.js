// Itens oficiais de uma licitação (PNCP): descrição, quantidade, unidade e valor unitário que o órgão estimou pagar.
// Usa a base guardada pelo sistema; se não tiver, busca no PNCP e guarda.
import { config } from '../config.js';
import { gravarItens } from './itens.js';

const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });

function doBanco(db, controle) {
  return db.prepare(`SELECT numero_item AS numero, descricao, quantidade, unidade, valor_estimado AS valorUnitario, beneficio
    FROM itens_licitacao WHERE compra_controle = ? ORDER BY numero_item`).all(controle);
}

export async function itensDaLicitacao(db, op, { fetchImpl = fetch } = {}) {
  const controle = op.numero_controle_pncp;
  let itens = doBanco(db, controle);
  let fonte = 'PNCP';
  if (!itens.length) {
    const m = String(controle ?? '').match(PARTES);
    if (!m) return { itens: [], total: null, sigilosos: 0, fonte: null };
    const base = config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');
    try {
      const r = await fetchImpl(`${base}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/itens?pagina=1&tamanhoPagina=1000`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.ok && r.status !== 204) {
        const lista = await r.json();
        const sigilo = new Set();
        gravarItens(db, (Array.isArray(lista) ? lista : []).map((it) => {
          if (it.orcamentoSigiloso) sigilo.add(it.numeroItem);
          return {
            compra: controle, numero: it.numeroItem, descricao: String(it.descricao ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
            material: it.materialOuServico === 'M' ? 1 : it.materialOuServico === 'S' ? 0 : null, unidade: it.unidadeMedida ?? null,
            quantidade: it.quantidade ?? null, estimado: it.orcamentoSigiloso ? null : it.valorUnitarioEstimado ?? null,
            situacao: it.situacaoCompraItemNome ?? null, criterio: it.criterioJulgamentoNome ?? null, beneficio: it.tipoBeneficioNome ?? null,
            fornecedorNi: null, fornecedorNome: null, valorResultado: null, quantidadeResultado: null, dataResultado: null,
            dataInclusao: String(it.dataInclusao ?? op.data_publicacao ?? '').slice(0, 19) || null, orgaoCnpj: m[1],
          };
        }));
        itens = doBanco(db, controle);
      }
    } catch {
      return { itens: [], total: null, sigilosos: 0, fonte: null, erro: 'O PNCP não respondeu agora.' };
    }
  }
  const lista = itens.map((i) => ({ ...i, valorTotal: i.valorUnitario != null && i.quantidade != null ? i.valorUnitario * i.quantidade : null }));
  const comValor = lista.filter((i) => i.valorTotal != null);
  return {
    itens: lista,
    total: comValor.length ? comValor.reduce((a, i) => a + i.valorTotal, 0) : null,
    sigilosos: lista.filter((i) => i.valorUnitario == null).length,
    fonte,
  };
}

/** Linhas curtas para avisos (sino/Telegram): quantos itens, total e os maiores. */
export function resumoDosItens(r, maximo = 5) {
  if (!r?.itens?.length) return [];
  const linhas = [`📦 ${r.itens.length} item(ns)${r.total ? ` · o órgão estima pagar ${brl(r.total)} no total` : ''}${r.sigilosos ? ` (${r.sigilosos} com valor sigiloso)` : ''}:`];
  const maiores = [...r.itens].sort((a, b) => (b.valorTotal ?? -1) - (a.valorTotal ?? -1)).slice(0, maximo);
  for (const i of maiores) {
    const nome = i.descricao.split(/[,;:]/)[0].slice(0, 60);
    const qtd = i.quantidade != null ? `${Number(i.quantidade).toLocaleString('pt-BR')} ${(i.unidade ?? 'un.').toLowerCase()}` : '';
    linhas.push(`• Item ${i.numero}: ${nome}${qtd ? ` — ${qtd}` : ''}${i.valorUnitario != null ? ` × ${brl(i.valorUnitario)}` : ' (valor sigiloso)'}`);
  }
  if (r.itens.length > maximo) linhas.push(`… e mais ${r.itens.length - maximo} item(ns) no sistema.`);
  return linhas;
}
