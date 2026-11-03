import { httpError, idParam } from '../http.js';

export default async function (app) {
  const { db } = app;

  // Junta datas de disputa dos negócios, vencimento de documentos e eventos manuais.
  app.get('/', async (req) => {
    const uid = req.usuarioId;
    const de = String(req.query.de ?? new Date().toISOString().slice(0, 10));
    const ate = String(req.query.ate ?? new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
    const ateFim = ate + 'T23:59:59';

    const disputas = db.prepare(`
      SELECT n.id AS negocio_id, n.titulo, n.data_disputa AS inicio, n.etapa, o.orgao_nome
      FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id
      WHERE n.usuario_id = ? AND n.arquivado = 0 AND n.data_disputa BETWEEN ? AND ?`).all(uid, de, ateFim)
      .map((r) => ({ tipo: 'disputa', ...r }));

    const vencimentos = db.prepare(`
      SELECT id AS documento_id, nome AS titulo, validade AS inicio
      FROM documentos WHERE usuario_id = ? AND validade BETWEEN ? AND ?`).all(uid, de, ate)
      .map((r) => ({ tipo: 'vencimento', ...r }));

    const eventos = db.prepare(`
      SELECT id AS evento_id, negocio_id, titulo, inicio, descricao
      FROM eventos WHERE usuario_id = ? AND inicio BETWEEN ? AND ?`).all(uid, de, ateFim)
      .map((r) => ({ tipo: 'evento', ...r }));

    return [...disputas, ...vencimentos, ...eventos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  });

  app.post('/eventos', {
    schema: {
      body: {
        type: 'object',
        required: ['titulo', 'inicio'],
        properties: {
          titulo: { type: 'string', minLength: 1, maxLength: 300 },
          inicio: { type: 'string', minLength: 10, maxLength: 30 },
          descricao: { type: ['string', 'null'], maxLength: 5000 },
          negocio_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body;
    if (b.negocio_id && !db.prepare('SELECT 1 FROM negocios WHERE id = ? AND usuario_id = ?').get(b.negocio_id, req.usuarioId)) {
      throw httpError(400, 'Negócio inválido.');
    }
    reply.code(201);
    return db.prepare('INSERT INTO eventos (usuario_id, negocio_id, titulo, inicio, descricao) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(req.usuarioId, b.negocio_id ?? null, b.titulo, b.inicio, b.descricao ?? null);
  });

  app.delete('/eventos/:id', async (req) => {
    const r = db.prepare('DELETE FROM eventos WHERE id = ? AND usuario_id = ?').run(idParam(req.params.id), req.usuarioId);
    if (!r.changes) throw httpError(404, 'Evento não encontrado.');
    return { ok: true };
  });
}
