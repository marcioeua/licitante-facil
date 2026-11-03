import { buscarOportunidades, sugerirMunicipios } from '../services/busca.js';
import { MODALIDADES } from '../services/pncp.js';
import { httpError, idParam } from '../http.js';
import { resumirEdital, perguntarEdital, historico, infoArquivos, comMensagensClaras, MODELO } from '../services/editalIA.js';

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

  app.get('/municipios', async (req) => sugerirMunicipios(db, req.query));

  const carregar = (id) => {
    const op = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(idParam(id));
    if (!op) throw httpError(404, 'Oportunidade não encontrada.');
    return op;
  };
  const opcoesIA = () => ({ client: app.ia, fetchImpl: app.fetchPncp });

  // Estado da leitura com IA: resumo (se já existe), arquivos lidos e perguntas do usuário.
  app.get('/:id/edital', async (req) => {
    const op = carregar(req.params.id);
    const salvo = db.prepare('SELECT resumo, modelo, criado_em FROM edital_resumos WHERE oportunidade_id = ?').get(op.id);
    return {
      iaDisponivel: !!app.ia,
      modelo: MODELO,
      resumo: salvo ? JSON.parse(salvo.resumo) : null,
      resumoCriadoEm: salvo?.criado_em ?? null,
      ...infoArquivos(db, op.id),
      perguntas: historico(db, op.id, req.usuarioId),
    };
  });

  app.post('/:id/edital/resumo', async (req) => {
    const op = carregar(req.params.id);
    return comMensagensClaras(() => resumirEdital(db, op, req.usuarioId, opcoesIA()));
  });

  app.post('/:id/edital/perguntas', {
    schema: { body: { type: 'object', required: ['pergunta'], properties: { pergunta: { type: 'string', minLength: 3, maxLength: 2000 } } } },
  }, async (req) => {
    const op = carregar(req.params.id);
    const p = await comMensagensClaras(() => perguntarEdital(db, op, req.usuarioId, req.body.pergunta.trim(), opcoesIA()));
    return { ...p, citacoes: JSON.parse(p.citacoes) };
  });

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
