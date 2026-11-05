import { httpError, idParam } from '../http.js';
import { TIPOS, analisarEdital, redigirPeca, formatarPeca, prazoImpugnacao } from '../services/juridico.js';

export default async function (app) {
  const { db } = app;
  const opcoes = () => ({ client: app.ia, fetchImpl: app.fetchPncp });
  const negocio = (uid, id) => {
    const n = db.prepare(`SELECT n.id, n.titulo, n.etapa, n.empresa_id, n.oportunidade_id, coalesce(n.data_disputa, o.data_encerramento, o.data_abertura) AS data_sessao, o.orgao_nome, o.modalidade,
        o.numero_compra, o.ano_compra, e.razao_social AS empresa
      FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id LEFT JOIN empresas e ON e.id = n.empresa_id
      WHERE n.id = ? AND n.usuario_id = ?`).get(idParam(id), uid);
    if (!n) throw httpError(404, 'Negócio não encontrado.');
    return n;
  };

  app.get('/', async (req) => {
    const uid = req.usuarioId;
    const n = req.query.negocio ? negocio(uid, req.query.negocio) : null;
    const pecas = db.prepare(`SELECT p.*, n.titulo AS negocio_titulo FROM pecas_juridicas p LEFT JOIN negocios n ON n.id = p.negocio_id
      WHERE p.usuario_id = ? ${n ? 'AND p.negocio_id = ?' : ''} ORDER BY p.id DESC LIMIT 100`).all(...(n ? [uid, n.id] : [uid])).map(formatarPeca);
    return {
      iaDisponivel: !!app.ia,
      tipos: TIPOS,
      negocio: n ? { ...n, prazo_impugnacao: prazoImpugnacao(n.data_sessao) } : null,
      pecas,
    };
  });

  app.post('/analise', { schema: { body: { type: 'object', required: ['negocio_id'], properties: { negocio_id: { type: 'integer' } } } } }, async (req) => {
    const n = negocio(req.usuarioId, req.body.negocio_id);
    return analisarEdital(db, n.id, req.usuarioId, opcoes());
  });

  const texto = (max) => ({ type: ['string', 'null'], maxLength: max });
  app.post('/pecas', {
    schema: {
      body: {
        type: 'object', required: ['negocio_id', 'tipo'],
        properties: {
          negocio_id: { type: 'integer' }, tipo: { type: 'string', enum: ['esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes'] },
          fatos: texto(20000), decisao: texto(40000), item: texto(200), representante: texto(200), cidade: texto(120),
        },
      },
    },
  }, async (req) => {
    const n = negocio(req.usuarioId, req.body.negocio_id);
    const { negocio_id: _, tipo, ...dados } = req.body;
    return redigirPeca(db, n.id, req.usuarioId, tipo, dados, opcoes());
  });

  app.patch('/pecas/:id', {
    schema: { body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { titulo: { type: 'string', minLength: 1, maxLength: 300 }, conteudo: { type: 'string', minLength: 1, maxLength: 200000 } } } },
  }, async (req) => {
    const p = db.prepare('SELECT * FROM pecas_juridicas WHERE id = ? AND usuario_id = ?').get(idParam(req.params.id), req.usuarioId);
    if (!p) throw httpError(404, 'Peça não encontrada.');
    if (p.tipo === 'analise' && req.body.conteudo) throw httpError(400, 'A análise não pode ser editada.');
    db.prepare(`UPDATE pecas_juridicas SET titulo = coalesce(?, titulo), conteudo = coalesce(?, conteudo), atualizado_em = datetime('now') WHERE id = ?`)
      .run(req.body.titulo ?? null, req.body.conteudo ?? null, p.id);
    return formatarPeca(db.prepare('SELECT * FROM pecas_juridicas WHERE id = ?').get(p.id));
  });

  app.delete('/pecas/:id', async (req) => {
    const r = db.prepare('DELETE FROM pecas_juridicas WHERE id = ? AND usuario_id = ?').run(idParam(req.params.id), req.usuarioId);
    if (!r.changes) throw httpError(404, 'Peça não encontrada.');
    return { ok: true };
  });
}
