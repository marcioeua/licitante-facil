import { httpError, idParam } from '../http.js';
import { linkDeLigacao, processarMensagensTelegram, enviarEditalTelegram } from '../services/telegram.js';

export default async function (app) {
  const { db } = app;
  const baseUrl = (req) => (process.env.APP_URL
    ?? `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`).replace(/\/$/, '');
  const cliente = () => {
    if (!app.telegram) throw httpError(503, 'O robô do Telegram ainda não foi configurado no servidor (falta TELEGRAM_BOT_TOKEN).');
    return app.telegram;
  };
  const traduzir = (e) => {
    if (e.statusCode) throw e;
    if (e.status === 401) throw httpError(502, 'O token do robô do Telegram é inválido. Confira TELEGRAM_BOT_TOKEN no Railway.');
    if (e.status === 403) throw httpError(502, 'Você bloqueou o robô no Telegram. Desbloqueie e conecte de novo.');
    throw httpError(502, `O Telegram recusou: ${e.message}`);
  };
  const estado = (uid) => {
    const u = db.prepare('SELECT telegram_chat_id, telegram_ativo, telegram_desde FROM usuarios WHERE id = ?').get(uid);
    return { servidor: !!app.telegram, conectado: !!u?.telegram_chat_id, ativo: !!u?.telegram_ativo, desde: u?.telegram_desde ?? null };
  };

  app.get('/', async (req) => estado(req.usuarioId));

  // Link para abrir o robô com o código de ligação.
  app.post('/conectar', async (req) => {
    try {
      return { link: await linkDeLigacao(db, cliente(), req.usuarioId) };
    } catch (e) { return traduzir(e); }
  });

  // Confere se o usuário já apertou "Começar" no robô.
  app.post('/verificar', async (req) => {
    try {
      await processarMensagensTelegram(db, cliente(), { log: (m) => req.log.warn(m) });
    } catch (e) { traduzir(e); }
    return estado(req.usuarioId);
  });

  app.put('/', { schema: { body: { type: 'object', required: ['ativo'], properties: { ativo: { type: 'boolean' } } } } }, async (req) => {
    const u = db.prepare('SELECT telegram_chat_id FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (req.body.ativo && !u?.telegram_chat_id) throw httpError(400, 'Conecte o Telegram primeiro.');
    db.prepare(`UPDATE usuarios SET telegram_ativo = ?, telegram_desde = CASE WHEN ? THEN datetime('now') ELSE telegram_desde END WHERE id = ?`)
      .run(req.body.ativo ? 1 : 0, req.body.ativo ? 1 : 0, req.usuarioId);
    return estado(req.usuarioId);
  });

  app.post('/teste', async (req) => {
    const u = db.prepare('SELECT telegram_chat_id FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (!u?.telegram_chat_id) throw httpError(400, 'Conecte o Telegram primeiro.');
    try {
      await cliente().enviarTexto(u.telegram_chat_id, '🔔 <b>Teste do Busca Pregão IA</b>\n\nTudo certo! Os avisos e os editais vão chegar por aqui.');
    } catch (e) { traduzir(e); }
    return { ok: true };
  });

  app.post('/edital/:oportunidadeId', async (req) => {
    const opId = idParam(req.params.oportunidadeId);
    try {
      const r = await enviarEditalTelegram(db, cliente(), req.usuarioId, opId, { fetchImpl: app.fetchPncp, appUrl: baseUrl(req) });
      db.prepare("INSERT INTO whatsapp_fila (usuario_id, oportunidade_id, origem, canal, tentativas, enviado_em, resultado) VALUES (?, ?, 'manual', 'telegram', 1, datetime('now'), ?)")
        .run(req.usuarioId, opId, JSON.stringify(r));
      return r;
    } catch (e) { return traduzir(e); }
  });
}
