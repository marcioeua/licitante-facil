// Licitações desertas (ninguém participou) e fracassadas (ninguém foi aprovado), item a item,
// com a situação oficial publicada nos Dados Abertos do Compras.gov.br. Costumam virar nova licitação
// ou compra direta (dispensa, art. 75, III, da Lei 14.133): são oportunidade para quem vende o item.
import { ftsQuery } from './busca.js';
import { completarCabecalhos } from './itens.js';

const PARTES = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/;
const SITUACOES = { deserto: ['Deserto'], fracassado: ['Fracassado'], ambos: ['Deserto', 'Fracassado'] };

export async function listarDesertas(db, q = {}, { fetchImpl = fetch } = {}) {
  const tamanho = 15;
  const pagina = Math.max(1, Number(q.pagina) || 1);
  const sits = SITUACOES[q.tipo] ?? SITUACOES.ambos;
  const p = {};
  const where = [`i.situacao IN (${sits.map((_, k) => `:s${k}`).join(',')})`];
  sits.forEach((s, k) => (p[`s${k}`] = s));
  let join = '';
  const fts = ftsQuery(q.q);
  if (fts) { join = 'JOIN itens_licitacao_fts f ON f.rowid = i.id'; where.push('itens_licitacao_fts MATCH :fts'); p.fts = fts; }
  if (/^[A-Za-z]{2}$/.test(q.uf ?? '')) { where.push('ic.uf = :uf'); p.uf = q.uf.toUpperCase(); }
  if (q.tipoObjeto === 'produto') where.push('i.material = 1');
  else if (q.tipoObjeto === 'servico') where.push('i.material = 0');
  const base = `FROM itens_licitacao i ${join} LEFT JOIN itens_compras ic ON ic.controle = i.compra_controle WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT count(DISTINCT i.compra_controle) AS n ${base}`).get(p).n;
  const pag = { ...p, lim: tamanho, off: (pagina - 1) * tamanho };
  const compras = db.prepare(`SELECT i.compra_controle AS controle, max(coalesce(i.data_resultado, substr(i.data_inclusao, 1, 10))) AS quando ${base}
    GROUP BY i.compra_controle ORDER BY quando DESC LIMIT :lim OFFSET :off`).all(pag);
  // Cabeçalho (órgão, UF, modalidade) que ainda falta: busca só os desta página.
  const faltam = compras.map((c) => c.controle).filter((c) => !db.prepare('SELECT 1 FROM itens_compras WHERE controle = ?').get(c));
  if (faltam.length) await Promise.race([completarCabecalhos(db, { fetchImpl, compras: faltam }).catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  const cab = db.prepare('SELECT * FROM itens_compras WHERE controle = ?');
  const itensDe = db.prepare(`SELECT numero_item AS numero, descricao, quantidade, unidade, valor_estimado AS valorUnitario, situacao
    FROM itens_licitacao WHERE compra_controle = ? AND situacao IN (${sits.map((_, k) => `:s${k}`).join(',')}) ORDER BY numero_item`);
  const totalItens = db.prepare('SELECT count(*) AS n FROM itens_licitacao WHERE compra_controle = ?');
  const params = Object.fromEntries(sits.map((s, k) => [`s${k}`, s]));
  return {
    total, pagina, tamanho,
    compras: compras.map((c) => {
      const h = cab.get(c.controle) ?? {};
      const itens = itensDe.all(params, c.controle);
      const m = String(c.controle).match(PARTES);
      const valorTotal = itens.reduce((a, i) => a + (i.valorUnitario != null && i.quantidade != null ? i.valorUnitario * i.quantidade : 0), 0);
      return {
        controle: c.controle, quando: c.quando, orgao: h.orgao ?? null, orgaoCnpj: m?.[1] ?? null, uf: h.uf ?? null, municipio: h.municipio ?? null,
        modalidade: h.modalidade ?? null, numero: h.numero ?? null, ano: h.ano ?? null, objeto: h.objeto ?? null,
        desertos: itens.filter((i) => i.situacao === 'Deserto').length, fracassados: itens.filter((i) => i.situacao === 'Fracassado').length,
        totalItensCompra: totalItens.get(c.controle).n, valorTotal: valorTotal || null,
        itens: itens.slice(0, 12), maisItens: Math.max(0, itens.length - 12),
        linkPncp: m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${m[2]}` : null,
      };
    }),
  };
}
