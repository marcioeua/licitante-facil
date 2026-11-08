import { idParam } from '../http.js';
import { conversar, conversaDoUsuario, paraTela } from '../services/assistente.js';

export default async function (app) {
  const { db } = app;
  const baseUrl = (req) => (process.env.APP_URL
    ?? `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`).replace(/\/$/, '');

  app.get('/conversas', async (req) => ({
    iaDisponivel: !!app.ia,
    conversas: db.prepare('SELECT id, titulo, atualizado_em FROM assistente_conversas WHERE usuario_id = ? ORDER BY atualizado_em DESC, id DESC LIMIT 50').all(req.usuarioId),
  }));

  app.get('/conversas/:id', async (req) => {
    const c = conversaDoUsuario(db, req.usuarioId, idParam(req.params.id));
    const mensagens = db.prepare('SELECT * FROM assistente_mensagens WHERE conversa_id = ? ORDER BY id').all(c.id).map(paraTela).filter(Boolean);
    return { id: c.id, titulo: c.titulo, mensagens };
  });

  app.post('/mensagens', {
    schema: { body: { type: 'object', required: ['mensagem'], properties: { conversaId: { type: ['integer', 'null'] }, mensagem: { type: 'string', minLength: 1, maxLength: 8000 } } } },
  }, async (req) => conversar(db, req.usuarioId, req.body, { client: app.ia, fetchImpl: app.fetchPncp, appUrl: baseUrl(req) }));

  app.delete('/conversas/:id', async (req) => {
    const c = conversaDoUsuario(db, req.usuarioId, idParam(req.params.id));
    db.prepare('DELETE FROM assistente_conversas WHERE id = ?').run(c.id);
    return { ok: true };
  });
}
