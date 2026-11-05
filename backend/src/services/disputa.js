// Assistente de disputa: o usuário planeja o preço mínimo de cada item e acompanha os lances.
// O sistema NÃO envia lances ao portal: só calcula e registra o que o usuário informa.
import { config } from '../config.js';
import { tx } from '../db/index.js';
import { httpError } from '../http.js';

const arred = (v, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;
// Lance para baixo: arredonda para baixo, para nunca ficar acima do alvo.
const piso = (v, casas) => Math.floor(v * 10 ** casas + 1e-9) / 10 ** casas;
const casasDe = (v) => (v != null && v < 1 ? 4 : 2);

export function precoMinimo(item) {
  if (item.custo == null) return null;
  return arred(item.custo * (1 + (item.margem_minima ?? 0)), casasDe(item.custo));
}

/** Próximo lance sugerido a partir do melhor lance atual, respeitando o mínimo do usuário. */
export function sugerirLance(item) {
  const minimo = precoMinimo(item);
  const casas = casasDe(item.melhor_lance ?? item.valor_estimado ?? item.custo);
  if (item.situacao === 'desisti' || item.situacao === 'perdido' || item.situacao === 'ganho') {
    return { minimo, valor: null, estado: 'encerrado', mensagem: 'Disputa encerrada para este item.' };
  }
  if (item.melhor_lance == null) {
    const inicial = item.lance_inicial ?? item.valor_estimado ?? null;
    if (inicial == null) return { minimo, valor: null, estado: 'sem_dados', mensagem: 'Informe o lance inicial ou o melhor lance da sala.' };
    if (minimo != null && inicial < minimo) return { minimo, valor: minimo, estado: 'abaixo_minimo', mensagem: 'O lance inicial está abaixo do seu mínimo. Revise o custo ou a margem.' };
    return { minimo, valor: arred(inicial, casas), estado: 'inicial', mensagem: 'Lance inicial (proposta).' };
  }
  if (item.meu_lance != null && item.meu_lance <= item.melhor_lance) {
    return { minimo, valor: null, estado: 'ganhando', mensagem: 'Seu lance é o melhor. Aguarde.' };
  }
  const dec = item.decremento_tipo === 'pct'
    ? item.melhor_lance * (item.decremento ?? 0)
    : (item.decremento ?? 0);
  const passo = Math.max(dec, 1 / 10 ** casas);
  const alvo = piso(item.melhor_lance - passo, casas);
  if (minimo != null && alvo < minimo) {
    return { minimo, valor: null, estado: 'parar', mensagem: `Cobrir o melhor lance exigiria ficar abaixo do seu mínimo (${minimo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: casas })}). Pare aqui.` };
  }
  return { minimo, valor: alvo, estado: 'cobrir', mensagem: 'Lance para cobrir o melhor da sala.' };
}

export function montarItem(db, item) {
  const lances = db.prepare('SELECT tipo, valor, criado_em FROM disputa_lances WHERE item_id = ? ORDER BY id DESC LIMIT 50').all(item.id);
  return { ...item, preco_minimo: precoMinimo(item), sugestao: sugerirLance(item), lances };
}

/** Importa os itens da compra no PNCP para a sala de disputa (sem duplicar). */
export async function importarItens(db, negocio, { fetchImpl = fetch } = {}) {
  const m = String(negocio.numero_controle_pncp ?? '').match(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/);
  if (!m) throw httpError(422, 'Este negócio não está ligado a uma licitação do PNCP. Adicione os itens manualmente.');
  const base = config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');
  let itens;
  try {
    const r = await fetchImpl(`${base}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/itens?pagina=1&tamanhoPagina=1000`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`PNCP ${r.status}`);
    itens = await r.json();
  } catch {
    throw httpError(502, 'Não foi possível buscar os itens no PNCP agora. Tente de novo em instantes.');
  }
  const existe = db.prepare('SELECT 1 FROM disputa_itens WHERE negocio_id = ? AND numero_item = ?');
  const ins = db.prepare(`INSERT INTO disputa_itens (negocio_id, numero_item, descricao, unidade, quantidade, valor_estimado)
    VALUES (?, ?, ?, ?, ?, ?)`);
  let n = 0;
  tx(db, () => {
    for (const it of Array.isArray(itens) ? itens : []) {
      if (existe.get(negocio.id, it.numeroItem)) continue;
      ins.run(negocio.id, it.numeroItem ?? null, String(it.descricao ?? `Item ${it.numeroItem}`).slice(0, 2000), it.unidadeMedida ?? null,
        it.quantidade ?? null, it.valorUnitarioEstimado || null);
      n++;
    }
  });
  return { importados: n, total: Array.isArray(itens) ? itens.length : 0 };
}
