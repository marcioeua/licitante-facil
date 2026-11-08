// Vitórias em licitações de um fornecedor, com dados abertos oficiais:
// - resultados dos itens (Compras.gov.br Dados Abertos, Lei 14.133): quem venceu e por quanto;
// - cabeçalho da compra e dados do item (PNCP): órgão, modalidade, número, abertura, portal,
//   descrição, quantidade, unidade, situação e preço estimado.
// Só mostra o que é público: não estima participações nem derrotas.
import { config } from '../config.js';
import { tx } from '../db/index.js';
import { portalDoLink } from './portais.js';
import { completarMarcas, marcaDoItem } from './marcas.js';

const DADOS_ABERTOS = process.env.DADOS_ABERTOS_URL ?? 'https://dadosabertos.compras.gov.br';
const ENDPOINT = '/modulo-contratacoes/3_consultarResultadoItensContratacoes_PNCP_14133';
const so = (v) => String(v ?? '').replace(/\D/g, '');
const dia = (d) => d.toISOString().slice(0, 10);
const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;

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
      fornecedorNi: r.niFornecedor ?? null,
      fornecedor: r.nomeRazaoSocialFornecedor ?? null,
      quantidade: r.quantidadeHomologada ?? null,
      valorUnitario: r.valorUnitarioHomologado ?? null,
      valorTotal: r.valorTotalHomologado ?? 0,
      data: (r.dataResultadoPncp ?? '').slice(0, 10) || null,
      porte: r.porteFornecedorNome ?? null,
      beneficioMeEpp: !!r.aplicacaoBeneficioMeepp,
      ordemSrp: r.ordemClassificacaoSrp ?? null,
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

function cabecalhoLocal(db, controle) {
  const salvo = db.prepare('SELECT dados FROM compras_cabecalho WHERE controle = ?').get(controle);
  if (salvo) return JSON.parse(salvo.dados);
  // Licitação que já passou pela base de oportunidades: usa sem consultar o PNCP.
  const o = db.prepare('SELECT * FROM oportunidades WHERE numero_controle_pncp = ?').get(controle);
  return o ? {
    orgao: o.orgao_nome, unidade: o.unidade_nome, municipio: o.municipio, uf: o.uf, modalidade: o.modalidade,
    numero: o.numero_compra, ano: o.ano_compra, abertura: o.data_abertura, linkOrigem: o.link_origem, objeto: o.objeto,
  } : null;
}

async function buscarCompra(db, controle, fetchImpl, timeoutMs) {
  const m = controle.match(PARTES);
  if (!m) return;
  const base = config.pncpBaseUrl;
  const pncp = base.replace(/\/api\/consulta$/, '/api/pncp');
  const sinal = () => AbortSignal.timeout(timeoutMs);
  const precisaCabecalho = !cabecalhoLocal(db, controle);
  const precisaItens = !db.prepare('SELECT 1 FROM compras_consultadas WHERE compra_controle = ?').get(controle);
  if (precisaCabecalho) {
    const r = await fetchImpl(`${base}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}`, { headers: { accept: 'application/json' }, signal: sinal() });
    if (!r.ok) throw new Error(`PNCP ${r.status}`);
    const c = await r.json();
    const dados = {
      orgao: c.orgaoEntidade?.razaoSocial ?? null, unidade: c.unidadeOrgao?.nomeUnidade ?? null,
      municipio: c.unidadeOrgao?.municipioNome ?? null, uf: c.unidadeOrgao?.ufSigla ?? null,
      modalidade: c.modalidadeNome ?? null, numero: c.numeroCompra ?? null, ano: c.anoCompra ?? null,
      abertura: c.dataAberturaProposta ?? null, linkOrigem: c.linkSistemaOrigem ?? null,
      objeto: String(c.objetoCompra ?? '').slice(0, 500), situacao: c.situacaoCompraNome ?? null,
    };
    db.prepare("INSERT OR REPLACE INTO compras_cabecalho (controle, dados, buscado_em) VALUES (?, ?, datetime('now'))").run(controle, JSON.stringify(dados));
  }
  if (precisaItens) {
    const r = await fetchImpl(`${pncp}/v1/orgaos/${m[1]}/compras/${m[3]}/${m[2]}/itens?pagina=1&tamanhoPagina=500`, { headers: { accept: 'application/json' }, signal: sinal() });
    if (!r.ok && r.status !== 204) throw new Error(`PNCP ${r.status}`);
    const lista = r.status === 204 ? [] : await r.json();
    const ins = db.prepare(`INSERT INTO compra_itens (compra_controle, numero_item, descricao, unidade, quantidade, valor_unit_estimado, tem_resultado, situacao, criterio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(compra_controle, numero_item) DO UPDATE SET situacao = excluded.situacao, criterio = excluded.criterio`);
    tx(db, () => {
      for (const it of lista) {
        ins.run(controle, it.numeroItem, String(it.descricao ?? '').slice(0, 1000), it.unidadeMedida ?? null, it.quantidade ?? null,
          it.valorUnitarioEstimado ?? null, it.temResultado ? 1 : 0, it.situacaoCompraItemNome ?? null, it.criterioJulgamentoNome ?? null);
      }
      db.prepare("INSERT OR REPLACE INTO compras_consultadas (compra_controle, consultado_em) VALUES (?, datetime('now'))").run(controle);
    });
  }
}

/**
 * Completa cabeçalho e itens das compras no PNCP, dentro de um orçamento de tempo.
 * Devolve quantas compras ficaram pendentes.
 */
export async function completarCompras(db, compras, fetchImpl, { orcamentoMs = 8000, maxCompras = 60 } = {}) {
  const prazo = Date.now() + orcamentoMs;
  const faltando = [...new Set(compras)].filter((c) => c
    && (!cabecalhoLocal(db, c) || !db.prepare('SELECT 1 FROM compras_consultadas WHERE compra_controle = ?').get(c))
    && !(falhasPncp.get(c) > Date.now() - 6 * 3600000) && !emAndamento.has(c)).slice(0, maxCompras);
  let feitas = 0;
  for (let i = 0; i < faltando.length && Date.now() < prazo; i += 4) {
    const restante = Math.max(1000, Math.min(15000, prazo - Date.now()));
    await Promise.allSettled(faltando.slice(i, i + 4).map(async (controle) => {
      emAndamento.add(controle);
      try {
        await buscarCompra(db, controle, fetchImpl, restante);
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

/** Título curto do item ("Caneta Esferográfica") a partir da descrição do catálogo. */
export function tituloItem(descricao) {
  if (!descricao) return null;
  const t = String(descricao).split(/\s+(?:Material|Tipo|Modelo|Características|Especificação|Marca|Cor|Tamanho|Dimens|Aspecto|Aplicação|Composição|Formato|Capacidade|Apresentação|Embalagem|Comprimento|Largura|Altura|Peso|Volume)\b|[,;:]/i)[0].trim();
  return (t.length > 3 ? t : String(descricao)).slice(0, 90);
}

const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'sem', 'a', 'o', 'as', 'os', 'tipo', 'uso', 'p', 'c']);
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ');
/** Chave do produto: as 3 primeiras palavras significativas do título ("caneta esferografica"). */
export function chaveProduto(titulo) {
  const p = normalizar(titulo).split(/\s+/).filter((w) => w.length > 1 && !PARADAS.has(w) && !/^\d+$/.test(w));
  return p.slice(0, 3).join(' ') || null;
}
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const maisComum = (v) => [...Map.groupBy(v.filter(Boolean), (x) => x)].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? null;

/** Agrupa os itens vencidos por produto: quantas vezes, quanto, faixa de preço unitário e para quantos órgãos. */
export function produtosVendidos(itens) {
  const comTitulo = itens.filter((i) => i.titulo && chaveProduto(i.titulo));
  return [...Map.groupBy(comTitulo, (i) => chaveProduto(i.titulo))].map(([chave, l]) => {
    const unidade = maisComum(l.map((i) => i.unidade));
    const precos = l.filter((i) => i.valorUnitario > 0 && (!unidade || i.unidade === unidade)).map((i) => i.valorUnitario);
    const datas = l.map((i) => i.data).filter(Boolean).sort();
    return {
      chave,
      nome: maisComum(l.map((i) => i.titulo)),
      vezes: l.length,
      compras: new Set(l.map((i) => i.compra)).size,
      valor: l.reduce((a, i) => a + (i.valorTotal || 0), 0),
      quantidade: l.reduce((a, i) => a + (Number(i.quantidade) || 0), 0),
      unidade,
      precoMin: precos.length ? Math.min(...precos) : null,
      precoMediano: precos.length ? mediana(precos) : null,
      precoMax: precos.length ? Math.max(...precos) : null,
      orgaos: new Set(l.map((i) => i.orgaoCnpj).filter(Boolean)).size,
      ufs: [...new Set(l.map((i) => i.uf).filter(Boolean))].sort(),
      ultima: datas.at(-1) ?? null,
      marcas: [...Map.groupBy(l.filter((i) => i.marca), (i) => normalizar(i.marca).replace(/\s+/g, ' ').trim())]
        .map(([, m]) => ({ marca: maisComum(m.map((i) => i.marca.trim())), vezes: m.length, valor: m.reduce((a, i) => a + (i.valorTotal || 0), 0) }))
        .sort((a, b) => b.vezes - a.vezes || b.valor - a.valor),
      exemplos: l.slice(0, 5).map((i) => ({ marca: i.marca, descricao: i.descricao, valorUnitario: i.valorUnitario, unidade: i.unidade, orgao: i.orgao, uf: i.uf, data: i.data, linkPncp: i.linkPncp })),
    };
  }).sort((a, b) => b.valor - a.valor || b.vezes - a.vezes);
}

export async function vitoriasDoFornecedor(db, ni, { anos = 3, fetchImpl = fetch } = {}) {
  const cnpj = so(ni);
  const nAnos = Math.min(5, Math.max(1, Number(anos) || 3));
  const { itens, falhas } = await vitoriasBrutas(db, cnpj, nAnos, fetchImpl);
  // Detalhes do PNCP: um pouco agora; o resto continua em segundo plano e aparece na próxima consulta.
  const comprasRecentes = [...itens].sort((a, b) => String(b.data).localeCompare(String(a.data))).map((i) => i.compra);
  const pendentes = await completarCompras(db, comprasRecentes, fetchImpl, { orcamentoMs: 6000 });
  if (pendentes) completarCompras(db, comprasRecentes, fetchImpl, { orcamentoMs: 240000, maxCompras: 300 }).catch(() => {});
  const recentesPrimeiro = [...itens].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const marcasPendentes = await completarMarcas(db, cnpj, recentesPrimeiro, fetchImpl, { orcamentoMs: 6000 });
  if (marcasPendentes) completarMarcas(db, cnpj, recentesPrimeiro, fetchImpl, { orcamentoMs: 300000, maxCompras: 400 }).catch(() => {});

  const det = db.prepare('SELECT descricao, unidade, quantidade, valor_unit_estimado, situacao, criterio FROM compra_itens WHERE compra_controle = ? AND numero_item = ?');
  const completos = itens.map((i) => {
    const d = det.get(i.compra, i.item);
    const c = cabecalhoLocal(db, i.compra);
    const m = String(i.compra ?? '').match(PARTES);
    const estimado = d?.valor_unit_estimado ?? null;
    return {
      ...i,
      titulo: tituloItem(d?.descricao),
      marca: marcaDoItem(db, i.compra, i.item, cnpj),
      descricao: d?.descricao ?? null,
      unidade: d?.unidade ?? null,
      quantidadeEstimada: d?.quantidade ?? null,
      valorEstimado: estimado,
      desconto: estimado && i.valorUnitario != null && estimado > 0 ? 1 - i.valorUnitario / estimado : null,
      situacaoItem: d?.situacao ?? null,
      criterio: d?.criterio ?? null,
      orgao: c?.orgao ?? null,
      unidadeCompradora: c?.unidade ?? null,
      municipio: c?.municipio ?? null,
      uf: c?.uf ?? i.uf,
      modalidade: c?.modalidade ?? null,
      numeroCompra: c?.numero ?? null,
      anoCompra: c?.ano ?? (m ? Number(m[3]) : null),
      abertura: c?.abertura ?? null,
      portal: portalDoLink(c?.linkOrigem),
      linkOrigem: c?.linkOrigem ?? null,
      linkPncp: m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${m[2]}` : null,
    };
  }).sort((a, b) => String(b.data).localeCompare(String(a.data)) || a.item - b.item);

  const soma = (lista) => lista.reduce((a, i) => a + (i.valorTotal || 0), 0);
  const agrupar = (chave) => [...Map.groupBy(completos, chave)].map(([k, l]) => ({ chave: k, itens: l.length, valor: soma(l), compras: new Set(l.map((i) => i.compra)).size }));
  const comDesconto = completos.filter((i) => i.desconto != null);
  return {
    cnpj,
    anos: nAnos,
    fonte: 'Compras.gov.br Dados Abertos (resultados da Lei 14.133) e PNCP (detalhes da compra e do item)',
    resumo: {
      itens: completos.length,
      compras: new Set(completos.map((i) => i.compra)).size,
      valor: soma(completos),
      orgaos: new Set(completos.map((i) => i.orgaoCnpj).filter(Boolean)).size,
      comMarca: completos.filter((i) => i.marca).length,
      beneficioMeEpp: completos.filter((i) => i.beneficioMeEpp).length,
      descontoMedio: comDesconto.length ? comDesconto.reduce((a, i) => a + i.desconto, 0) / comDesconto.length : null,
    },
    porAno: agrupar((i) => (i.data ?? '????').slice(0, 4)).sort((a, b) => a.chave.localeCompare(b.chave)),
    porUf: agrupar((i) => i.uf ?? '—').sort((a, b) => b.valor - a.valor),
    porPortal: agrupar((i) => i.portal ?? 'Não identificado').sort((a, b) => b.itens - a.itens),
    orgaos: [...Map.groupBy(completos, (i) => i.orgaoCnpj ?? '—')].map(([k, l]) => ({ cnpj: k, nome: l[0].orgao, itens: l.length, valor: soma(l), uf: l[0].uf }))
      .sort((a, b) => b.valor - a.valor).slice(0, 10),
    produtos: produtosVendidos(completos).slice(0, 200),
    itensSemDescricao: completos.filter((i) => !i.titulo).length,
    marcas: [...Map.groupBy(completos.filter((i) => i.marca), (i) => normalizar(i.marca).replace(/\s+/g, ' ').trim())]
      .map(([, m]) => ({ marca: maisComum(m.map((i) => i.marca.trim())), vezes: m.length, valor: soma(m), produtos: [...new Set(m.map((i) => i.titulo).filter(Boolean))].slice(0, 5) }))
      .sort((a, b) => b.valor - a.valor).slice(0, 100),
    itensComMarca: completos.filter((i) => i.marca).length,
    marcasPendentes,
    itens: completos.slice(0, 500),
    detalhesPendentes: pendentes,
    falhas,
  };
}
