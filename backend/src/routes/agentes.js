import { httpError, idParam } from '../http.js';
import { AGENTES, lerConfig, salvarConfig, executarProspector, executarVigia, executarLeitor } from '../services/agentes.js';
import { resumirEdital } from '../services/editalIA.js';

export default async function (app) {
  const { db } = app;
  const agenteValido = (a) => {
    if (!AGENTES[a]) throw httpError(404, 'Agente desconhecido.');
    return a;
  };

  app.get('/', async (req) => Object.entries(AGENTES).map(([id, a]) => {
    const c = lerConfig(db, req.usuarioId, id);
    const recentes = db.prepare('SELECT id, tipo, titulo, criado_em FROM notificacoes WHERE usuario_id = ? AND agente = ? ORDER BY id DESC LIMIT 5')
      .all(req.usuarioId, id);
    return { id, nome: a.nome, descricao: a.descricao, precisaIA: !!a.precisaIA, iaDisponivel: !!app.ia, ...c, recentes };
  }));

  app.put('/:agente', {
    schema: { body: { type: 'object', properties: { ativo: { type: 'boolean' }, config: { type: 'object' } }, additionalProperties: false } },
  }, async (req) => salvarConfig(db, req.usuarioId, agenteValido(req.params.agente), req.body));

  // Executa o agente agora, só para o usuário logado.
  app.post('/:agente/executar', async (req) => {
    const a = agenteValido(req.params.agente);
    if (a === 'prospector') return executarProspector(db, req.usuarioId);
    if (a === 'vigia') return executarVigia(db, req.usuarioId, { fetchImpl: app.fetchPncp });
    return executarLeitor(db, req.usuarioId, { client: app.ia, fetchImpl: app.fetchPncp, resumir: resumirEdital });
  });
}

export async function notificacoesRoutes(app) {
  const { db } = app;
  app.get('/', async (req) => ({
    naoLidas: db.prepare('SELECT count(*) AS n FROM notificacoes WHERE usuario_id = ? AND lida = 0').get(req.usuarioId).n,
    itens: db.prepare('SELECT * FROM notificacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT ?').all(req.usuarioId, Math.min(100, Number(req.query.limite) || 30)),
  }));
  app.post('/lidas', {
    schema: { body: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, todas: { type: 'boolean' } } } },
  }, async (req) => {
    if (req.body.todas) db.prepare('UPDATE notificacoes SET lida = 1 WHERE usuario_id = ?').run(req.usuarioId);
    else if (req.body.ids?.length) {
      db.prepare(`UPDATE notificacoes SET lida = 1 WHERE usuario_id = ? AND id IN (${req.body.ids.map(() => '?').join(',')})`)
        .run(req.usuarioId, ...req.body.ids.map(idParam));
    }
    return { ok: true };
  });
}
