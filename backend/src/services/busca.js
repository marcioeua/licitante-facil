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
    where.push("(o.data_encerramento IS NULL OR o.data_encerramento >= strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))");
  }
  if (filtros.publicadasDesde) {
    where.push('o.importado_em > :desde');
    params.desde = filtros.publicadasDesde;
  }
  if (filtros.srp === true || filtros.srp === 'true') where.push('o.registro_preco = 1');

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
    SELECT o.*, n.id AS negocio_id, n.etapa AS negocio_etapa
    FROM oportunidades o ${join}
    LEFT JOIN negocios n ON n.oportunidade_id = o.id AND n.usuario_id = :uid
    ${whereSql}
    ORDER BY ${ordem}
    LIMIT :lim OFFSET :off
  `).all(params);
  return { total, pagina, tamanho, itens };
}
