import { httpError, idParam } from '../http.js';
import { normalizarNumero, enviarEdital, MODELOS } from '../services/whatsapp.js';

export default async function (app) {
  const { db } = app;
  const baseUrl = (req) => (process.env.APP_URL
    ?? `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`).replace(/\/$/, '');
  const exigirCliente = () => {
    if (!app.whatsapp) throw httpError(503, 'O WhatsApp ainda não foi conectado no servidor (falta a conta da Meta).');
    return app.whatsapp;
  };
  const erroMeta = (e) => {
    if (e.statusCode) throw e;
    // Mensagens comuns da Meta traduzidas para o usuário.
    if (e.codigo === 132001) throw httpError(502, `O modelo de mensagem ainda não foi aprovado pela Meta (${MODELOS.aviso()} / ${MODELOS.edital()}).`);
    if (e.codigo === 131030) throw httpError(502, 'Este número ainda não está liberado para receber mensagens de teste da Meta.');
    if (e.codigo === 190) throw httpError(502, 'O token do WhatsApp expirou ou é inválido. Avise o administrador.');
    throw httpError(502, `O WhatsApp recusou o envio: ${e.message}`);
  };

  app.get('/', async (req) => {
    const u = db.prepare('SELECT whatsapp, whatsapp_ativo, whatsapp_desde FROM usuarios WHERE id = ?').get(req.usuarioId);
    return { servidor: !!app.whatsapp, numero: u?.whatsapp ?? null, ativo: !!u?.whatsapp_ativo, desde: u?.whatsapp_desde ?? null };
  });

  app.put('/', {
    schema: { body: { type: 'object', required: ['numero', 'ativo'], properties: { numero: { type: ['string', 'null'], maxLength: 30 }, ativo: { type: 'boolean' }, consentimento: { type: 'boolean' } } } },
  }, async (req) => {
    const { ativo, consentimento } = req.body;
    const numero = req.body.numero ? normalizarNumero(req.body.numero) : null;
    if (req.body.numero && !numero) throw httpError(400, 'Número inválido. Use DDD + número, ex.: (11) 98765-4321.');
    if (ativo && !numero) throw httpError(400, 'Informe o número do WhatsApp.');
    if (ativo && !consentimento) throw httpError(400, 'Marque a autorização para receber avisos pelo WhatsApp.');
    const atual = db.prepare('SELECT whatsapp_ativo FROM usuarios WHERE id = ?').get(req.usuarioId);
    db.prepare(`UPDATE usuarios SET whatsapp = ?, whatsapp_ativo = ?,
      whatsapp_desde = CASE WHEN ? AND NOT ? THEN datetime('now') ELSE whatsapp_desde END WHERE id = ?`)
      .run(numero, ativo ? 1 : 0, ativo ? 1 : 0, atual?.whatsapp_ativo ? 1 : 0, req.usuarioId);
    const u = db.prepare('SELECT whatsapp, whatsapp_ativo, whatsapp_desde FROM usuarios WHERE id = ?').get(req.usuarioId);
    return { servidor: !!app.whatsapp, numero: u.whatsapp, ativo: !!u.whatsapp_ativo, desde: u.whatsapp_desde };
  });

  app.post('/teste', async (req) => {
    const cliente = exigirCliente();
    const u = db.prepare('SELECT whatsapp FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (!u?.whatsapp) throw httpError(400, 'Salve o seu número primeiro.');
    try {
      await cliente.enviarAviso(u.whatsapp, 'Teste do Busca Pregão IA', 'Pronto! Os avisos dos seus agentes e os editais das licitações vão chegar por aqui.');
    } catch (e) { erroMeta(e); }
    return { ok: true };
  });

  // Envia agora o edital (PDF) de uma licitação para o WhatsApp do usuário.
  app.post('/edital/:oportunidadeId', async (req) => {
    const cliente = exigirCliente();
    const opId = idParam(req.params.oportunidadeId);
    try {
      const r = await enviarEdital(db, cliente, req.usuarioId, opId, { fetchImpl: app.fetchPncp, appUrl: baseUrl(req) });
      db.prepare("INSERT INTO whatsapp_fila (usuario_id, oportunidade_id, origem, tentativas, enviado_em, resultado) VALUES (?, ?, 'manual', 1, datetime('now'), ?)")
        .run(req.usuarioId, opId, JSON.stringify(r));
      return r;
    } catch (e) { return erroMeta(e); }
  });
}
