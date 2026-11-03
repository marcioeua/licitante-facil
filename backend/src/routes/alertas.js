import { httpError, idParam } from '../http.js';
import { buscarOportunidades } from '../services/busca.js';

const body = {
  type: 'object',
  required: ['nome', 'palavras'],
  properties: {
    nome: { type: 'string', minLength: 1, maxLength: 120 },
    palavras: { type: 'string', minLength: 2, maxLength: 1000 },
    ufs: { type: 'array', items: { type: 'string', minLength: 2, maxLength: 2 }, maxItems: 27 },
    modalidades: { type: 'array', items: { type: 'integer' }, maxItems: 20 },
    municipios: { type: 'array', items: { type: 'string', pattern: '^[A-Z]{2}:.+$', maxLength: 120 }, maxItems: 50 },
    valor_min: { type: ['number', 'null'] },
    valor_max: { type: ['number', 'null'] },
    email_ativo: { type: 'boolean' },
  },
};

export function parseAlerta(a) {
  return { ...a, ufs: JSON.parse(a.ufs), modalidades: JSON.parse(a.modalidades), municipios: JSON.parse(a.municipios ?? '[]'), email_ativo: !!a.email_ativo };
}

/** Filtros de busca equivalentes a um alerta. */
export function filtrosDoAlerta(a) {
  return {
    palavrasOu: a.palavras,
    uf: a.ufs,
    municipio: a.municipios ?? [],
    modalidade: a.modalidades,
    valorMin: a.valor_min,
    valorMax: a.valor_max,
  };
}

export default async function (app) {
  const { db } = app;
  const params = (uid, b) => [
    b.nome.trim(), b.palavras.trim(), JSON.stringify(b.ufs ?? []), JSON.stringify(b.modalidades ?? []),
    b.valor_min ?? null, b.valor_max ?? null, b.email_ativo === false ? 0 : 1, JSON.stringify(b.municipios ?? []),
  ];

  app.get('/', async (req) =>
    db.prepare('SELECT * FROM alertas WHERE usuario_id = ? ORDER BY nome').all(req.usuarioId).map(parseAlerta));

  app.post('/', { schema: { body } }, async (req, reply) => {
    reply.code(201);
    return parseAlerta(db.prepare(`
      INSERT INTO alertas (nome, palavras, ufs, modalidades, valor_min, valor_max, email_ativo, municipios, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(...params(req.usuarioId, req.body), req.usuarioId));
  });

  app.put('/:id', { schema: { body } }, async (req) => {
    const a = db.prepare(`
      UPDATE alertas SET nome = ?, palavras = ?, ufs = ?, modalidades = ?, valor_min = ?, valor_max = ?, email_ativo = ?, municipios = ?
      WHERE id = ? AND usuario_id = ? RETURNING *`).get(...params(req.usuarioId, req.body), idParam(req.params.id), req.usuarioId);
    if (!a) throw httpError(404, 'Alerta não encontrado.');
    return parseAlerta(a);
  });

  app.delete('/:id', async (req) => {
    const r = db.prepare('DELETE FROM alertas WHERE id = ? AND usuario_id = ?').run(idParam(req.params.id), req.usuarioId);
    if (!r.changes) throw httpError(404, 'Alerta não encontrado.');
    return { ok: true };
  });

  // Prévia: oportunidades que este alerta encontra agora.
  app.get('/:id/resultados', async (req) => {
    const a = db.prepare('SELECT * FROM alertas WHERE id = ? AND usuario_id = ?').get(idParam(req.params.id), req.usuarioId);
    if (!a) throw httpError(404, 'Alerta não encontrado.');
    return buscarOportunidades(db, { ...filtrosDoAlerta(parseAlerta(a)), pagina: req.query.pagina, tamanho: req.query.tamanho }, req.usuarioId);
  });
}
