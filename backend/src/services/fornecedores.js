// Agente Fornecedor: quem vende cada item (vencedores de compras públicas parecidas, dados do PNCP)
// e material para pedir cotação (planilha e e-mail).
import { pesquisarPrecos } from './historico.js';
import { cadastroCnpj } from './empresas.js';
import { tituloItem } from './vitorias.js';

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const PARADAS = new Set(['para', 'com', 'sem', 'serv', 'tipo', 'material', 'servico', 'servicos', 'aquisicao', 'contratacao', 'fornecimento',
  'empresa', 'unidade', 'item', 'itens', 'registro', 'precos', 'preco', 'eventual', 'futura', 'futuras', 'eventuais', 'especializada',
  'prestacao', 'atender', 'demanda', 'secretaria', 'municipal', 'municipio', 'diversos', 'diversas', 'destinados', 'destinadas', 'conforme']);
const palavrasDe = (t) => (String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

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

/** Fornecedores que venceram itens parecidos, com preços homologados. */
export async function fornecedoresDoItem(db, descricao, { q, uf, objeto, fetchImpl } = {}) {
  let busca = String(q ?? termosDoItem(descricao)).trim();
  if (busca.length < 3) return { q: busca, fornecedores: [], grupos: [] };
  const assunto = assuntoDoObjeto(objeto);
  const pesquisar = async (termo) => {
    // Primeiro pelo próprio produto; depois pelo assunto da licitação (contratos descrevem o objeto de forma geral).
    let r = await pesquisarPrecos(db, { q: termo }, { fetchImpl, maxCompras: 10 });
    if (assunto && new Set(r.itens.map((i) => i.fornecedorNi)).size < 5) {
      r = await pesquisarPrecos(db, { q: termo, assunto }, { fetchImpl, maxCompras: 20 });
    }
    return r;
  };
  let r = await pesquisar(busca);
  const primeira = busca.split(' ')[0];
  if (!q && !r.itens.length && primeira !== busca && primeira.length >= 4) {
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
  return { q: busca, assunto: assunto || null, grupos: r.grupos.slice(0, 3), fornecedores };
}

/** Contato público do fornecedor (cadastro na Receita). */
export async function contatoFornecedor(db, ni, { fetchImpl } = {}) {
  const c = await cadastroCnpj(db, ni, { fetchImpl, log: () => {} });
  if (!c) return null;
  return { razaoSocial: c.razaoSocial, nomeFantasia: c.nomeFantasia, email: c.email ?? null, telefone: c.telefone ?? null,
    municipio: c.municipio, uf: c.uf, situacao: c.situacao, atividade: c.atividade };
}
