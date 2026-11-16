// Agente Fornecedor: quem vende cada item (vencedores de compras públicas parecidas, dados do PNCP)
// e material para pedir cotação (planilha e e-mail).
import { pesquisarPrecos } from './historico.js';
import { cadastroCnpj } from './empresas.js';
import { tituloItem } from './vitorias.js';
import { ftsQuery } from './busca.js';

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const PARADAS = new Set(['para', 'com', 'sem', 'serv', 'tipo', 'material', 'servico', 'servicos', 'aquisicao', 'contratacao', 'fornecimento',
  'empresa', 'unidade', 'item', 'itens', 'registro', 'precos', 'preco', 'eventual', 'futura', 'futuras', 'eventuais', 'especializada',
  'prestacao', 'atender', 'demanda', 'secretaria', 'municipal', 'municipio', 'diversos', 'diversas', 'destinados', 'destinadas', 'conforme']);
// Palavras com 3+ letras, e também códigos curtos com número ("a4", "2l", "5w").
const palavrasDe = (t) => (String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [])
  .filter((w) => w.length >= 3 || (/\d/.test(w) && /[a-z]/.test(w)));

/** Termos de busca a partir da descrição do item: as duas primeiras palavras do título. */
export function termosDoItem(descricao) {
  const t = tituloItem(descricao) ?? String(descricao ?? '');
  return palavrasDe(t).filter((p) => !PARADAS.has(p)).slice(0, 2).join(' ');
}

/** Assunto da licitação (ex.: "material limpeza"), para achar compras parecidas pelos contratos. */
export function assuntoDoObjeto(objeto) {
  const p = palavrasDe(objeto);
  // "material de limpeza" e "material escolar" dizem muito: mantém "material" quando vem antes do assunto.
  const uteis = p.filter((w, i) => !PARADAS.has(w) || (w === 'material' && p[i + 1] && !PARADAS.has(p[i + 1])));
  return uteis.slice(0, 2).join(' ');
}

const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;
/**
 * Vencedores de itens parecidos na base guardada pelo sistema (itens das licitações com resultado,
 * Dados Abertos do Compras.gov.br). É local: responde na hora, mesmo com o PNCP fora do ar.
 */
export function vencedoresGuardados(db, termo, limite = 400) {
  const fts = ftsQuery(termo);
  if (!fts) return [];
  try {
    return db.prepare(`SELECT i.descricao, i.unidade, i.quantidade_resultado, i.valor_resultado, i.fornecedor_ni, i.fornecedor_nome, i.data_resultado,
        i.compra_controle, ic.orgao, ic.uf
      FROM itens_licitacao_fts f JOIN itens_licitacao i ON i.id = f.rowid LEFT JOIN itens_compras ic ON ic.controle = i.compra_controle
      WHERE itens_licitacao_fts MATCH :fts AND i.fornecedor_ni IS NOT NULL AND i.valor_resultado > 0
      ORDER BY i.data_resultado DESC LIMIT :lim`).all({ fts, lim: limite }).map((l) => {
      const m = String(l.compra_controle).match(PARTES);
      return {
        descricao: l.descricao, unidade: l.unidade, quantidade: l.quantidade_resultado, valorUnitario: l.valor_resultado,
        fornecedor: l.fornecedor_nome, fornecedorNi: l.fornecedor_ni, porte: null, orgao: l.orgao, uf: l.uf, data: l.data_resultado,
        link: m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${m[2]}` : null, compra: l.compra_controle,
      };
    });
  } catch {
    return []; // base de itens ainda não criada
  }
}

function gruposPorUnidade(itens) {
  return [...Map.groupBy(itens.filter((i) => i.valorUnitario > 0), (i) => String(i.unidade ?? 'Não informada').trim())]
    .map(([unidade, ls]) => ({ unidade, quantidade: ls.length, mediana: mediana(ls.map((l) => l.valorUnitario)), minimo: Math.min(...ls.map((l) => l.valorUnitario)) }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Fornecedores que venceram itens parecidos, com preços homologados. */
export async function fornecedoresDoItem(db, descricao, { q, uf, objeto, fetchImpl, reduzir = false } = {}) {
  let busca = String(q ?? termosDoItem(descricao)).trim();
  if (busca.length < 3) return { q: busca, fornecedores: [], grupos: [] };
  const assunto = assuntoDoObjeto(objeto);
  const pesquisar = async (termo) => {
    // 1) Base guardada pelo sistema (instantânea). 2) PNCP pelos contratos, só se faltar fornecedor.
    const guardados = vencedoresGuardados(db, termo);
    const qtd = (lista) => new Set(lista.map((i) => i.fornecedorNi)).size;
    if (qtd(guardados) >= 8) return { itens: guardados, grupos: gruposPorUnidade(guardados), incompleto: false };
    let r = { itens: [], incompleto: false };
    try {
      r = await pesquisarPrecos(db, { q: termo }, { fetchImpl, maxCompras: 10, prazoMs: 15000 });
      if (assunto && qtd([...guardados, ...r.itens]) < 5) {
        const r2 = await pesquisarPrecos(db, { q: termo, assunto }, { fetchImpl, maxCompras: 20, prazoMs: 20000 });
        r = { ...r2, incompleto: r.incompleto || r2.incompleto };
      }
    } catch {
      r = { itens: [], incompleto: true }; // PNCP fora do ar: fica com o que já temos
    }
    const vistos = new Set(guardados.map((i) => `${i.link}|${i.fornecedorNi}|${i.valorUnitario}`));
    const itens = [...guardados, ...r.itens.filter((i) => !vistos.has(`${String(i.link ?? '')}|${i.fornecedorNi}|${i.valorUnitario}`))];
    return { itens, grupos: gruposPorUnidade(itens), incompleto: !!r.incompleto || r.falhas > 0 };
  };
  let r = await pesquisar(busca);
  const primeira = busca.split(' ')[0];
  // Sem resultado: tenta só pela palavra principal ("ventilador de parede 60cm" → "ventilador").
  if ((!q || reduzir) && !r.itens.length && primeira !== busca && primeira.length >= 4) {
    busca = primeira;
    r = await pesquisar(busca);
  }
  const porFornecedor = Map.groupBy(r.itens.filter((i) => i.fornecedorNi), (i) => i.fornecedorNi);
  const unidade = (u) => String(u ?? 'Não informada').trim().toUpperCase();
  const fornecedores = [...porFornecedor].map(([ni, its]) => {
    // Preços só da unidade de medida mais vendida por este fornecedor (não mistura caixa com unidade).
    const porUnidade = [...Map.groupBy(its, (i) => unidade(i.unidade))].sort((a, b) => b[1].length - a[1].length);
    const [unidadePreco, daUnidade] = porUnidade[0];
    const precos = daUnidade.map((i) => i.valorUnitario).filter((v) => v > 0);
    return {
      unidadePreco,
      ni,
      nome: its[0].fornecedor,
      porte: its[0].porte,
      vitorias: its.length,
      menorPreco: precos.length ? Math.min(...precos) : null,
      precoMediano: precos.length ? mediana(precos) : null,
      unidades: [...new Set(its.map((i) => i.unidade).filter(Boolean))].slice(0, 3),
      ufsAtendidas: [...new Set(its.map((i) => i.uf).filter(Boolean))],
      ultimaVenda: its.map((i) => i.data).filter(Boolean).sort().at(-1) ?? null,
      exemplos: its.slice(0, 3).map((i) => ({ descricao: i.descricao, valorUnitario: i.valorUnitario, unidade: i.unidade, orgao: i.orgao, uf: i.uf, data: i.data, link: i.link })),
    };
  })
    // Quem atende o mesmo estado e vendeu mais vezes aparece primeiro.
    .sort((a, b) => (uf ? Number(b.ufsAtendidas.includes(uf)) - Number(a.ufsAtendidas.includes(uf)) : 0) || b.vitorias - a.vitorias || (b.ultimaVenda ?? '').localeCompare(a.ultimaVenda ?? ''))
    .slice(0, 15);
  return { q: busca, assunto: assunto || null, grupos: r.grupos.slice(0, 3), fornecedores, incompleto: !!r.incompleto };
}

/** Contato público do fornecedor (cadastro na Receita). */
export async function contatoFornecedor(db, ni, { fetchImpl } = {}) {
  const c = await cadastroCnpj(db, ni, { fetchImpl, log: () => {} });
  if (!c) return null;
  return { razaoSocial: c.razaoSocial, nomeFantasia: c.nomeFantasia, email: c.email ?? null, telefone: c.telefone ?? null,
    municipio: c.municipio, uf: c.uf, situacao: c.situacao, atividade: c.atividade };
}
