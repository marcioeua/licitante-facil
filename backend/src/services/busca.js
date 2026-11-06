import { nivelRisco } from './capag.js';
// Busca de oportunidades com texto livre (FTS5) e filtros.

/** Transforma o texto digitado em consulta FTS5 segura: cada termo vira prefixo. */
export function ftsQuery(texto) {
  const termos = String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .match(/[a-z0-9]+/g);
  if (!termos?.length) return null;
  return termos.map((t) => `"${t}"*`).join(' ');
}

/** Palavras de um alerta: separadas por vírgula; qualquer uma delas basta (OU). */
export function ftsQueryOu(palavras) {
  const grupos = String(palavras ?? '')
    .split(',')
    .map((p) => ftsQuery(p))
    .filter(Boolean)
    .map((q) => `(${q})`);
  return grupos.length ? grupos.join(' OR ') : null;
}

export function buscarOportunidades(db, filtros = {}, usuarioId = null) {
  const where = [];
  const params = {};
  let join = '';

  const q = filtros.palavrasOu ? ftsQueryOu(filtros.palavrasOu) : ftsQuery(filtros.q);
  if (q) {
    join = 'JOIN oportunidades_fts f ON f.rowid = o.id';
    where.push('oportunidades_fts MATCH :q');
    params.q = q;
  }
  const lista = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).filter(Boolean);
  const ufs = lista(filtros.uf);
  if (ufs.length) {
    where.push(`o.uf IN (${ufs.map((_, i) => `:uf${i}`).join(',')})`);
    ufs.forEach((u, i) => (params[`uf${i}`] = u.toUpperCase()));
  }
  // Cidades no formato "UF:Município" (o mesmo nome existe em vários estados).
  const cidades = lista(filtros.municipio)
    .map((c) => String(c).split(':'))
    .filter(([uf, nome]) => uf && nome);
  if (cidades.length) {
    where.push('(' + cidades.map((_, i) => `(o.uf = :cuf${i} AND o.municipio = :cmun${i} COLLATE NOCASE)`).join(' OR ') + ')');
    cidades.forEach(([uf, nome], i) => {
      params[`cuf${i}`] = uf.toUpperCase();
      params[`cmun${i}`] = nome;
    });
  }
  const mods = lista(filtros.modalidade).map(Number).filter(Number.isFinite);
  if (mods.length) {
    where.push(`o.modalidade_id IN (${mods.map((_, i) => `:m${i}`).join(',')})`);
    mods.forEach((m, i) => (params[`m${i}`] = m));
  }
  if (filtros.valorMin != null && filtros.valorMin !== '') {
    where.push('o.valor_estimado >= :vmin');
    params.vmin = Number(filtros.valorMin);
  }
  if (filtros.valorMax != null && filtros.valorMax !== '') {
    where.push('o.valor_estimado <= :vmax');
    params.vmax = Number(filtros.valorMax);
  }
  if (filtros.abertas !== false && filtros.abertas !== 'false') {
    // Sem prazo de propostas = compra direta já decidida (ex.: dispensa "sem disputa"): ninguém pode participar.
    where.push("o.data_encerramento IS NOT NULL AND o.data_encerramento >= strftime('%Y-%m-%dT%H:%M:%S','now','localtime')");
  }
  if (filtros.publicadasDesde) {
    where.push('o.importado_em > :desde');
    params.desde = filtros.publicadasDesde;
  }
  if (filtros.srp === true || filtros.srp === 'true') where.push('o.registro_preco = 1');
  if (filtros.encerraDepoisDe) {
    // data_encerramento está no horário de Brasília (sem fuso).
    where.push("o.data_encerramento >= :encDepois");
    params.encDepois = new Date(new Date(filtros.encerraDepoisDe).getTime() - 3 * 3600000).toISOString().slice(0, 19);
  }
  if (filtros.comResumo) where.push('o.id IN (SELECT oportunidade_id FROM edital_resumos)');

  const ordem = {
    encerramento: 'o.data_encerramento IS NULL, o.data_encerramento ASC',
    publicacao: 'o.data_publicacao DESC',
    valor: 'o.valor_estimado IS NULL, o.valor_estimado DESC',
    relevancia: q ? 'f.rank' : 'o.data_publicacao DESC',
  }[filtros.ordem ?? (q ? 'relevancia' : 'encerramento')] ?? 'o.data_encerramento ASC';

  const pagina = Math.max(1, Number(filtros.pagina) || 1);
  const tamanho = Math.min(100, Math.max(1, Number(filtros.tamanho) || 20));
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT count(*) AS n FROM oportunidades o ${join} ${whereSql}`).get(params).n;
  params.lim = tamanho;
  params.off = (pagina - 1) * tamanho;
  params.uid = usuarioId ?? -1;
  const itens = db.prepare(`
    SELECT o.*, n.id AS negocio_id, n.etapa AS negocio_etapa,
      coalesce(cm.capag, ce.capag) AS capag, coalesce(cm.nota3, ce.nota3) AS capag_nota3
    FROM oportunidades o ${join}
    LEFT JOIN negocios n ON n.oportunidade_id = o.id AND n.usuario_id = :uid
    LEFT JOIN capag_entes cm ON o.esfera = 'M' AND cm.tipo = 'municipio' AND cm.codigo = o.codigo_ibge
    LEFT JOIN capag_entes ce ON o.esfera IN ('E', 'D') AND ce.tipo = 'estado' AND ce.codigo = o.uf
    ${whereSql}
    ORDER BY ${ordem}
    LIMIT :lim OFFSET :off
  `).all(params).map((o) => ({
    ...o,
    pagometro: o.esfera === 'F' ? 'federal' : o.capag ? nivelRisco({ capag: o.capag, nota3: o.capag_nota3 }) : null,
  }));
  return { total, pagina, tamanho, itens };
}

/** Sugestões de cidades para o filtro (com quantidade de licitações abertas). Ignora acentos. */
export function sugerirMunicipios(db, { q = '', uf = '' } = {}, limite = 20) {
  const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const termo = norm(q);
  const ufs = new Set(String(uf).split(',').map((u) => u.trim().toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u)));
  const linhas = db.prepare(`
    SELECT uf, municipio, count(*) AS total FROM oportunidades
    WHERE municipio IS NOT NULL
      AND data_encerramento IS NOT NULL AND data_encerramento >= strftime('%Y-%m-%dT%H:%M:%S','now','localtime')
    GROUP BY uf, municipio`).all();
  return linhas
    .filter((r) => (!ufs.size || ufs.has(r.uf)) && (!termo || norm(r.municipio).includes(termo)))
    .sort((a, b) => {
      // Cidades que começam com o termo vêm primeiro; depois, as com mais licitações.
      const pa = norm(a.municipio).startsWith(termo) ? 0 : 1;
      const pb = norm(b.municipio).startsWith(termo) ? 0 : 1;
      return pa - pb || b.total - a.total || a.municipio.localeCompare(b.municipio);
    })
    .slice(0, limite)
    .map((r) => ({ valor: `${r.uf}:${r.municipio}`, nome: `${r.municipio}/${r.uf}`, total: r.total }));
}
