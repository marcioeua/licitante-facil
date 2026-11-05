// Vitórias em licitações de um fornecedor, com dados abertos oficiais do Compras.gov.br
// (resultados de itens das contratações da Lei 14.133 publicadas no PNCP).
// Só mostra o que é público: itens vencidos e valores homologados. Não estima participações nem derrotas.
import { config } from '../config.js';
import { tx } from '../db/index.js';

const DADOS_ABERTOS = process.env.DADOS_ABERTOS_URL ?? 'https://dadosabertos.compras.gov.br';
const ENDPOINT = '/modulo-contratacoes/3_consultarResultadoItensContratacoes_PNCP_14133';
const so = (v) => String(v ?? '').replace(/\D/g, '');
const dia = (d) => d.toISOString().slice(0, 10);

/** Janelas de até 365 dias (limite da API), da mais recente para a mais antiga. */
export function janelas(anos, hoje = new Date()) {
  const lista = [];
  let fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  for (let i = 0; i < anos; i++) {
    const ini = new Date(fim.getTime() - 364 * 86400000);
    lista.push({ ini: dia(ini), fim: dia(fim), atual: i === 0 });
    fim = new Date(ini.getTime() - 86400000);
  }
  return lista;
}

async function buscarJanela(cnpj, j, fetchImpl) {
  const itens = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const url = `${DADOS_ABERTOS}${ENDPOINT}?pagina=${pagina}&tamanhoPagina=500&niFornecedor=${cnpj}`
      + `&dataResultadoPncpInicial=${j.ini}&dataResultadoPncpFinal=${j.fim}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Compras.gov.br respondeu ${res.status}`);
    const d = await res.json();
    itens.push(...(d.resultado ?? []));
    if (!d.paginasRestantes || !(d.resultado ?? []).length) break;
  }
  return itens
    .filter((r) => !r.dataCancelamentoPncp && !r.motivoCancelamento)
    .map((r) => ({
      compra: r.numeroControlePNCPCompra ?? r.idContratacaoPNCP,
      item: r.numeroItemPncp,
      orgaoCnpj: r.orgaoEntidadeCnpj ?? null,
      uf: r.unidadeOrgaoUfSigla ?? null,
      quantidade: r.quantidadeHomologada ?? null,
      valorUnitario: r.valorUnitarioHomologado ?? null,
      valorTotal: r.valorTotalHomologado ?? 0,
      data: (r.dataResultadoPncp ?? '').slice(0, 10) || null,
      porte: r.porteFornecedorNome ?? null,
      beneficioMeEpp: !!r.aplicacaoBeneficioMeepp,
      desconto: r.percentualDesconto ?? null,
    }));
}

/** Busca (com cache) as vitórias dos últimos `anos`. Janela atual vale 1 dia; anteriores, 30 dias. */
async function vitoriasBrutas(db, cnpj, anos, fetchImpl) {
  const todos = [];
  const falhas = [];
  for (const j of janelas(anos)) {
    const validade = j.atual ? '-1 day' : '-30 days';
    const salvo = db.prepare(`SELECT dados FROM vitorias_cache WHERE cnpj = ? AND janela = ? AND buscado_em > datetime('now', ?)`)
      .get(cnpj, `${j.ini}/${j.fim}`, validade);
    if (salvo) { todos.push(...JSON.parse(salvo.dados)); continue; }
    try {
      const itens = await buscarJanela(cnpj, j, fetchImpl);
      db.prepare("INSERT OR REPLACE INTO vitorias_cache (cnpj, janela, dados, buscado_em) VALUES (?, ?, ?, datetime('now'))")
        .run(cnpj, `${j.ini}/${j.fim}`, JSON.stringify(itens));
      todos.push(...itens);
    } catch (e) {
      falhas.push(`${j.ini} a ${j.fim}: ${e.cause?.code ?? e.message}`);
    }
  }
  return { itens: todos, falhas };
}

// Compras cujo PNCP falhou recentemente: espera 6h antes de tentar de novo (o PNCP às vezes trava).
const falhasPncp = new Map();
const emAndamento = new Set();

/**
 * Descrição dos itens: busca no PNCP (com cache em compra_itens) para as compras ainda não vistas,
 * dentro de um orçamento de tempo. Devolve quantas compras ficaram pendentes.
 */
export async function completarDescricoes(db, itens, fetchImpl, { orcamentoMs = 8000, maxCompras = 40 } = {}) {
  const pncp = config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');
  const prazo = Date.now() + orcamentoMs;
  const faltando = [...new Set(itens.map((i) => i.compra))].filter((c) => c
    && !db.prepare('SELECT 1 FROM compras_consultadas WHERE compra_controle = ?').get(c)
    && !(falhasPncp.get(c) > Date.now() - 6 * 3600000) && !emAndamento.has(c)).slice(0, maxCompras);
  const ins = db.prepare(`INSERT INTO compra_itens (compra_controle, numero_item, descricao, unidade, quantidade, valor_unit_estimado, tem_resultado)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(compra_controle, numero_item) DO NOTHING`);
  let feitas = 0;
  for (let i = 0; i < faltando.length && Date.now() < prazo; i += 4) {
    const restante = Math.max(1000, prazo - Date.now());
    await Promise.allSettled(faltando.slice(i, i + 4).map(async (controle) => {
      const m = controle.match(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/);
      if (!m) return;
      emAndamento.add(controle);
      try {
        const res = await fetchImpl(`${pncp}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/itens?pagina=1&tamanhoPagina=500`,
          { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(Math.min(15000, restante)) });
        if (!res.ok && res.status !== 204) throw new Error(`PNCP ${res.status}`);
        const lista = res.status === 204 ? [] : await res.json();
        tx(db, () => {
          for (const it of lista) {
            ins.run(controle, it.numeroItem, String(it.descricao ?? '').slice(0, 1000), it.unidadeMedida ?? null,
              it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.temResultado ? 1 : 0);
          }
          db.prepare("INSERT OR REPLACE INTO compras_consultadas (compra_controle, consultado_em) VALUES (?, datetime('now'))").run(controle);
        });
        feitas++;
      } catch {
        falhasPncp.set(controle, Date.now());
      } finally {
        emAndamento.delete(controle);
      }
    }));
  }
  return Math.max(0, faltando.length - feitas);
}

export async function vitoriasDoFornecedor(db, ni, { anos = 3, fetchImpl = fetch } = {}) {
  const cnpj = so(ni);
  const nAnos = Math.min(5, Math.max(1, Number(anos) || 3));
  const { itens, falhas } = await vitoriasBrutas(db, cnpj, nAnos, fetchImpl);
  // Descrições: um pouco agora; o resto continua em segundo plano e aparece na próxima consulta.
  const pendentes = await completarDescricoes(db, itens, fetchImpl, { orcamentoMs: 5000 });
  if (pendentes) completarDescricoes(db, itens, fetchImpl, { orcamentoMs: 180000 }).catch(() => {});
  const desc = db.prepare('SELECT descricao, unidade, valor_unit_estimado FROM compra_itens WHERE compra_controle = ? AND numero_item = ?');
  const nomeOrgao = db.prepare(`SELECT nome FROM (SELECT orgao_nome AS nome FROM contratos WHERE orgao_cnpj = ?
    UNION ALL SELECT orgao_nome FROM oportunidades WHERE orgao_cnpj = ?) WHERE nome IS NOT NULL LIMIT 1`);

  const completos = itens.map((i) => {
    const d = desc.get(i.compra, i.item);
    return { ...i, descricao: d?.descricao ?? null, unidade: d?.unidade ?? null, valorEstimado: d?.valor_unit_estimado ?? null,
      orgao: (i.orgaoCnpj && nomeOrgao.get(i.orgaoCnpj, i.orgaoCnpj)?.nome) || null };
  }).sort((a, b) => String(b.data).localeCompare(String(a.data)));

  const soma = (lista) => lista.reduce((a, i) => a + (i.valorTotal || 0), 0);
  const agrupar = (chave) => [...Map.groupBy(completos, chave)].map(([k, l]) => ({ chave: k, itens: l.length, valor: soma(l), compras: new Set(l.map((i) => i.compra)).size }));
  const total = soma(completos);
  return {
    cnpj,
    anos: nAnos,
    fonte: 'Compras.gov.br — Dados Abertos (resultados de itens da Lei 14.133 publicados no PNCP)',
    resumo: {
      itens: completos.length,
      compras: new Set(completos.map((i) => i.compra)).size,
      valor: total,
      orgaos: new Set(completos.map((i) => i.orgaoCnpj).filter(Boolean)).size,
      beneficioMeEpp: completos.filter((i) => i.beneficioMeEpp).length,
    },
    porAno: agrupar((i) => (i.data ?? '????').slice(0, 4)).sort((a, b) => a.chave.localeCompare(b.chave)),
    porUf: agrupar((i) => i.uf ?? '—').sort((a, b) => b.valor - a.valor),
    orgaos: [...Map.groupBy(completos, (i) => i.orgaoCnpj ?? '—')].map(([k, l]) => ({ cnpj: k, nome: l[0].orgao, itens: l.length, valor: soma(l), uf: l[0].uf }))
      .sort((a, b) => b.valor - a.valor).slice(0, 10),
    itens: completos.slice(0, 200),
    descricoesPendentes: pendentes,
    falhas,
  };
}
