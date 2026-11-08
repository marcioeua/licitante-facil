import { httpError, idParam } from '../http.js';
import { tx } from '../db/index.js';
import { arquivarVencidas } from '../services/agentes.js';

export const ETAPAS = ['triagem', 'analise', 'proposta', 'disputa', 'ganho', 'perdido'];

export const CHECKLIST_PADRAO = [
  'Ler o edital completo',
  'Conferir habilitação jurídica e fiscal',
  'Conferir qualificação técnica e econômica',
  'Verificar certidões válidas na data da disputa',
  'Montar proposta de preços',
  'Cadastrar proposta no portal',
  'Acompanhar sessão de disputa',
];

const negocioProps = {
  titulo: { type: 'string', minLength: 1, maxLength: 500 },
  etapa: { type: 'string', enum: ETAPAS },
  empresa_id: { type: ['integer', 'null'] },
  responsavel: { type: ['string', 'null'], maxLength: 120 },
  valor_proposta: { type: ['number', 'null'] },
  data_disputa: { type: ['string', 'null'], maxLength: 30 },
  notas: { type: ['string', 'null'], maxLength: 20000 },
  favorito: { type: 'boolean' },
  arquivado: { type: 'boolean' },
  posicao: { type: 'integer' },
};

export default async function (app) {
  const { db } = app;

  const carregar = (uid, id) => {
    const n = db.prepare(`
      SELECT n.*, o.objeto, o.orgao_nome, o.uf, o.municipio, o.modalidade, o.valor_estimado,
             o.data_abertura, o.data_encerramento, o.link_pncp, o.link_origem, o.numero_compra, o.ano_compra,
             e.razao_social AS empresa_nome
      FROM negocios n
      LEFT JOIN oportunidades o ON o.id = n.oportunidade_id
      LEFT JOIN empresas e ON e.id = n.empresa_id
      WHERE n.id = ? AND n.usuario_id = ?`).get(id, uid);
    if (!n) throw httpError(404, 'Negócio não encontrado.');
    n.checklist = db.prepare('SELECT * FROM checklist_itens WHERE negocio_id = ? ORDER BY posicao, id').all(id);
    n.documentos = db.prepare(`
      SELECT d.id, d.nome, d.categoria, d.validade, d.arquivo_nome
      FROM negocio_documentos nd JOIN documentos d ON d.id = nd.documento_id
      WHERE nd.negocio_id = ? ORDER BY d.nome`).all(id);
    return n;
  };

  // Lista para o kanban.
  app.get('/', async (req) => {
    arquivarVencidas(db, req.usuarioId);
    const arquivados = req.query.arquivados === 'true' ? 1 : 0;
    return db.prepare(`
      SELECT n.id, n.titulo, n.etapa, n.responsavel, n.favorito, n.arquivado, n.posicao, n.data_disputa, n.origem, n.pontuacao,
             n.valor_proposta, o.orgao_nome, o.uf, o.valor_estimado, o.data_encerramento, o.modalidade,
             e.razao_social AS empresa_nome,
             (SELECT count(*) FROM checklist_itens c WHERE c.negocio_id = n.id) AS checklist_total,
             (SELECT count(*) FROM checklist_itens c WHERE c.negocio_id = n.id AND c.feito = 1) AS checklist_feitos,
             (SELECT count(*) FROM disputa_itens d WHERE d.negocio_id = n.id) AS itens_disputa,
             (SELECT count(*) FROM disputa_itens d WHERE d.negocio_id = n.id AND d.custo IS NOT NULL) AS itens_com_custo
      FROM negocios n
      LEFT JOIN oportunidades o ON o.id = n.oportunidade_id
      LEFT JOIN empresas e ON e.id = n.empresa_id
      WHERE n.usuario_id = ? AND n.arquivado = ?
      ORDER BY n.posicao, n.id DESC`).all(req.usuarioId, arquivados);
  });

  app.get('/:id', async (req) => carregar(req.usuarioId, idParam(req.params.id)));

  // Cria a partir de uma oportunidade (oportunidade_id) ou manualmente (titulo).
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        properties: { oportunidade_id: { type: 'integer' }, ...negocioProps },
      },
    },
  }, async (req, reply) => {
    const uid = req.usuarioId;
    const b = req.body;
    let titulo = b.titulo;
    let dataDisputa = b.data_disputa ?? null;
    if (b.oportunidade_id) {
      const op = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(b.oportunidade_id);
      if (!op) throw httpError(404, 'Oportunidade não encontrada.');
      const existente = db.prepare('SELECT id FROM negocios WHERE usuario_id = ? AND oportunidade_id = ?').get(uid, op.id);
      if (existente) throw httpError(409, 'Esta oportunidade já está no seu funil.');
      if (!op.data_encerramento) {
        throw httpError(400, 'Esta compra não recebe propostas: é uma contratação direta já decidida (sem prazo de propostas no PNCP).');
      }
      const encerrada = db.prepare("SELECT ? < strftime('%Y-%m-%dT%H:%M:%S','now','localtime') AS v").get(op.data_encerramento).v;
      if (encerrada) {
        const quando = new Date(op.data_encerramento).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        throw httpError(400, `O prazo de propostas desta licitação terminou em ${quando}. Não é mais possível participar.`);
      }
      titulo ??= op.objeto.slice(0, 300);
      dataDisputa ??= op.data_encerramento;
    }
    if (!titulo) throw httpError(400, 'Informe o título.');
    if (b.empresa_id) checarEmpresa(uid, b.empresa_id);
    const id = tx(db, () => {
      const { id } = db.prepare(`
        INSERT INTO negocios (usuario_id, oportunidade_id, empresa_id, titulo, etapa, responsavel, data_disputa, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(
        uid, b.oportunidade_id ?? null, b.empresa_id ?? null, titulo, b.etapa ?? 'triagem',
        b.responsavel ?? null, dataDisputa, b.notas ?? null,
      );
      const ins = db.prepare('INSERT INTO checklist_itens (negocio_id, texto, posicao) VALUES (?, ?, ?)');
      CHECKLIST_PADRAO.forEach((t, i) => ins.run(id, t, i));
      return id;
    });
    reply.code(201);
    return carregar(uid, id);
  });

  function checarEmpresa(uid, empresaId) {
    if (!db.prepare('SELECT 1 FROM empresas WHERE id = ? AND usuario_id = ?').get(empresaId, uid)) {
      throw httpError(400, 'Empresa inválida.');
    }
  }

  app.patch('/:id', {
    schema: { body: { type: 'object', properties: negocioProps, additionalProperties: false } },
  }, async (req) => {
    const uid = req.usuarioId;
    const id = idParam(req.params.id);
    carregar(uid, id);
    const b = { ...req.body };
    if (b.empresa_id) checarEmpresa(uid, b.empresa_id);
    for (const k of ['favorito', 'arquivado']) if (k in b) b[k] = b[k] ? 1 : 0;
    const campos = Object.keys(b);
    if (campos.length) {
      db.prepare(`UPDATE negocios SET ${campos.map((c) => `${c} = :${c}`).join(', ')}, atualizado_em = datetime('now')
                  WHERE id = :id AND usuario_id = :uid`).run({ ...b, id, uid });
    }
    return carregar(uid, id);
  });

  // Reordena após arrastar no kanban: [{id, etapa, posicao}]
  app.post('/reordenar', {
    schema: {
      body: {
        type: 'array',
        maxItems: 1000,
        items: {
          type: 'object',
          required: ['id', 'etapa', 'posicao'],
          properties: { id: { type: 'integer' }, etapa: { type: 'string', enum: ETAPAS }, posicao: { type: 'integer' } },
        },
      },
    },
  }, async (req) => {
    const stmt = db.prepare("UPDATE negocios SET etapa = ?, posicao = ?, atualizado_em = datetime('now') WHERE id = ? AND usuario_id = ?");
    tx(db, () => req.body.forEach((i) => stmt.run(i.etapa, i.posicao, i.id, req.usuarioId)));
    return { ok: true };
  });

  app.delete('/:id', async (req) => {
    const r = db.prepare('DELETE FROM negocios WHERE id = ? AND usuario_id = ?').run(idParam(req.params.id), req.usuarioId);
    if (!r.changes) throw httpError(404, 'Negócio não encontrado.');
    return { ok: true };
  });

  // Checklist
  app.post('/:id/checklist', {
    schema: { body: { type: 'object', required: ['texto'], properties: { texto: { type: 'string', minLength: 1, maxLength: 500 } } } },
  }, async (req) => {
    const id = idParam(req.params.id);
    carregar(req.usuarioId, id);
    const pos = db.prepare('SELECT coalesce(max(posicao), -1) + 1 AS p FROM checklist_itens WHERE negocio_id = ?').get(id).p;
    return db.prepare('INSERT INTO checklist_itens (negocio_id, texto, posicao) VALUES (?, ?, ?) RETURNING *').get(id, req.body.texto, pos);
  });

  app.patch('/:id/checklist/:itemId', {
    schema: { body: { type: 'object', properties: { texto: { type: 'string', minLength: 1 }, feito: { type: 'boolean' } } } },
  }, async (req) => {
    const id = idParam(req.params.id);
    carregar(req.usuarioId, id);
    const item = db.prepare('SELECT * FROM checklist_itens WHERE id = ? AND negocio_id = ?').get(idParam(req.params.itemId), id);
    if (!item) throw httpError(404, 'Item não encontrado.');
    return db.prepare('UPDATE checklist_itens SET texto = ?, feito = ? WHERE id = ? RETURNING *').get(
      req.body.texto ?? item.texto, 'feito' in req.body ? (req.body.feito ? 1 : 0) : item.feito, item.id,
    );
  });

  app.delete('/:id/checklist/:itemId', async (req) => {
    const id = idParam(req.params.id);
    carregar(req.usuarioId, id);
    db.prepare('DELETE FROM checklist_itens WHERE id = ? AND negocio_id = ?').run(idParam(req.params.itemId), id);
    return { ok: true };
  });

  // Documentos vinculados
  app.put('/:id/documentos/:docId', async (req) => {
    const id = idParam(req.params.id);
    const docId = idParam(req.params.docId);
    carregar(req.usuarioId, id);
    if (!db.prepare('SELECT 1 FROM documentos WHERE id = ? AND usuario_id = ?').get(docId, req.usuarioId)) {
      throw httpError(404, 'Documento não encontrado.');
    }
    db.prepare('INSERT OR IGNORE INTO negocio_documentos (negocio_id, documento_id) VALUES (?, ?)').run(id, docId);
    return { ok: true };
  });

  app.delete('/:id/documentos/:docId', async (req) => {
    const id = idParam(req.params.id);
    carregar(req.usuarioId, id);
    db.prepare('DELETE FROM negocio_documentos WHERE negocio_id = ? AND documento_id = ?').run(id, idParam(req.params.docId));
    return { ok: true };
  });
}
