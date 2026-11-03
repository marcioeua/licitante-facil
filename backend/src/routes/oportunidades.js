import { buscarOportunidades } from '../services/busca.js';
import { MODALIDADES } from '../services/pncp.js';
import { httpError, idParam } from '../http.js';

export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export default async function (app) {
  const { db } = app;

  app.get('/', async (req) => buscarOportunidades(db, req.query, req.usuarioId));

  app.get('/filtros', async () => ({
    ufs: UFS,
    modalidades: Object.entries(MODALIDADES).map(([id, nome]) => ({ id: Number(id), nome })),
    ultimaSincronizacao: db.prepare(
      'SELECT finalizado_em, importadas, erro FROM sincronizacoes WHERE finalizado_em IS NOT NULL ORDER BY id DESC LIMIT 1',
    ).get() ?? null,
  }));

  app.get('/:id', async (req) => {
    const op = db.prepare(`
      SELECT o.*, n.id AS negocio_id, n.etapa AS negocio_etapa
      FROM oportunidades o
      LEFT JOIN negocios n ON n.oportunidade_id = o.id AND n.usuario_id = ?
      WHERE o.id = ?`).get(req.usuarioId, idParam(req.params.id));
    if (!op) throw httpError(404, 'Oportunidade não encontrada.');
    return op;
  });
}
