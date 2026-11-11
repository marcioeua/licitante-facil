// Itens que o fornecedor venceu na licitação de um contrato do histórico, com valor e marca.
// Fontes oficiais: Dados Abertos do Compras.gov.br (itens e vencedor; marca pela pesquisa de preço)
// e, para outros portais, o PNCP (itens e resultados).
import { config } from '../config.js';
import { completarMarcas, marcaDoItem } from './marcas.js';

const DADOS_ABERTOS = process.env.DADOS_ABERTOS_URL ?? 'https://dadosabertos.compras.gov.br';
const so = (v) => String(v ?? '').replace(/\D/g, '');
const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;

async function getJson(url, fetchImpl, timeoutMs = 20000) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (r.status === 404 || r.status === 204) return null;
  if (!r.ok) throw new Error(`respondeu ${r.status}`);
  return r.json();
}

async function pelosDadosAbertos(controle, ni, fetchImpl) {
  const d = await getJson(`${DADOS_ABERTOS}/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id?tipo=numeroControlePNCPCompra&codigo=${encodeURIComponent(controle)}`, fetchImpl);
  const todos = d?.resultado ?? [];
  if (!todos.length) return null;
  return todos.filter((it) => it.temResultado && so(it.codFornecedor) === ni).map((it) => ({
    numero: it.numeroItemPncp,
    descricao: String(it.descricaodetalhada || it.descricaoResumida || '').replace(/\s+/g, ' ').trim(),
    unidade: it.unidadeMedida ?? null,
    quantidade: it.quantidadeResultado ?? it.quantidade ?? null,
    valorUnitario: it.valorUnitarioResultado ?? null,
    valorTotal: it.valorTotalResultado ?? null,
    valorEstimado: it.orcamentoSigiloso ? null : it.valorUnitarioEstimado ?? null,
  }));
}

async function peloPncp(controle, ni, fetchImpl) {
  const m = controle.match(PARTES);
  if (!m) return [];
  const base = `${config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp')}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/itens`;
  const itens = ((await getJson(`${base}?pagina=1&tamanhoPagina=500`, fetchImpl)) ?? []).filter((it) => it.temResultado).slice(0, 60);
  const out = [];
  for (let i = 0; i < itens.length; i += 4) {
    const lote = await Promise.all(itens.slice(i, i + 4).map(async (it) => {
      const res = ((await getJson(`${base}/${it.numeroItem}/resultados`, fetchImpl).catch(() => null)) ?? [])
        .filter((r) => !r.dataCancelamento && so(r.niFornecedor) === ni);
      return res.map((r) => ({
        numero: it.numeroItem, descricao: String(it.descricao ?? '').replace(/\s+/g, ' ').trim(), unidade: it.unidadeMedida ?? null,
        quantidade: r.quantidadeHomologada ?? it.quantidade ?? null, valorUnitario: r.valorUnitarioHomologado ?? null,
        valorTotal: r.valorTotalHomologado ?? null, valorEstimado: it.valorUnitarioEstimado ?? null,
      }));
    }));
    out.push(...lote.flat());
  }
  return out;
}

export async function itensDoContrato(db, contratoId, uidIgnorado, { fetchImpl = fetch } = {}) {
  const c = db.prepare('SELECT id, compra_controle, fornecedor_ni, fornecedor_nome, numero_controle_pncp FROM contratos WHERE id = ?').get(contratoId);
  if (!c) throw Object.assign(new Error('Contrato não encontrado.'), { statusCode: 404 });
  const ni = so(c.fornecedor_ni);
  const m = String(c.compra_controle ?? '').match(PARTES);
  const linkCompra = m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${m[2]}` : null;
  if (!c.compra_controle || !ni) return { itens: [], linkCompra, aviso: 'Este contrato não informa a licitação de origem no PNCP.' };

  let itens = null;
  let fonte = 'Compras.gov.br Dados Abertos';
  let aviso = null;
  try { itens = await pelosDadosAbertos(c.compra_controle, ni, fetchImpl); } catch { itens = null; }
  if (itens == null) {
    fonte = 'PNCP';
    try { itens = await peloPncp(c.compra_controle, ni, fetchImpl); } catch (e) {
      itens = [];
      aviso = `O PNCP não respondeu agora (${e.message}). Tente de novo em alguns minutos.`;
    }
  }
  // Marca declarada pelo vencedor (só existe para compras do Compras.gov.br com item de catálogo).
  if (itens.length) {
    await completarMarcas(db, ni, itens.map((i) => ({ compra: c.compra_controle, item: i.numero })), fetchImpl, { orcamentoMs: 8000 }).catch(() => {});
    itens = itens.map((i) => ({ ...i, marca: marcaDoItem(db, c.compra_controle, i.numero, ni) }));
  }
  itens.sort((a, b) => a.numero - b.numero);
  return {
    fornecedor: c.fornecedor_nome, itens, fonte, aviso, linkCompra,
    semMarca: itens.length > 0 && !itens.some((i) => i.marca),
  };
}
