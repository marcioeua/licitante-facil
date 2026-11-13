// Avisos pelo Telegram (API oficial de robôs do Telegram, gratuita).
// O usuário liga a conta abrindo o link t.me/<robô>?start=<código>; o sistema lê as mensagens
// recebidas pelo robô (getUpdates) e associa o chat ao usuário.
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { montarEnvioEdital } from './whatsapp.js';

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const corta = (t, max) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

export function clienteTelegram({ fetchImpl = fetch } = {}) {
  // Tolera token colado com espaços, quebras de linha, aspas ou com "bot" na frente.
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').replace(/\s+/g, '').replace(/^["']+|["']+$/g, '').replace(/^bot(?=\d)/i, '');
  if (!token) return null;
  const base = `https://api.telegram.org/bot${token}`;
  const chamar = async (metodo, corpo) => {
    const init = corpo instanceof FormData
      ? { method: 'POST', body: corpo }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {}) };
    const r = await fetchImpl(`${base}/${metodo}`, { ...init, signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(j.description || `Telegram respondeu ${r.status}`), { status: j.error_code ?? r.status });
    return j.result;
  };
  let eu = null;
  return {
    async nomeDoRobo() {
      eu ??= await chamar('getMe');
      return eu.username;
    },
    atualizacoes: (offset) => chamar('getUpdates', { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] }),
    enviarTexto: (chatId, html, { teclado } = {}) => chamar('sendMessage', {
      chat_id: chatId, text: corta(html, 4000), parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      ...(teclado ? { reply_markup: { inline_keyboard: teclado } } : {}),
    }),
    responderBotao: (id, texto) => chamar('answerCallbackQuery', { callback_query_id: id, text: corta(texto, 190) }),
    enviarDocumento(chatId, { bytes, nomeArquivo, legenda, teclado }) {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', corta(legenda, 1000));
      form.append('parse_mode', 'HTML');
      if (teclado) form.append('reply_markup', JSON.stringify({ inline_keyboard: teclado }));
      form.append('document', new Blob([bytes], { type: 'application/pdf' }), nomeArquivo);
      return chamar('sendDocument', form);
    },
  };
}

/** Gera o código de ligação e devolve o link para abrir o robô. */
export async function linkDeLigacao(db, cliente, uid) {
  const codigo = randomBytes(9).toString('base64url');
  db.prepare('UPDATE usuarios SET telegram_codigo = ? WHERE id = ?').run(codigo, uid);
  return `https://t.me/${await cliente.nomeDoRobo()}?start=${codigo}`;
}

/** Lê as mensagens recebidas pelo robô: /start <código> liga a conta, /parar desliga. */
// Uma leitura de mensagens por vez (a escuta e o botão "verificar" da página podem coincidir).
let lendoMensagens = null;
export function processarMensagensTelegram(db, cliente, opcoes = {}) {
  if (!cliente) return Promise.resolve(0);
  lendoMensagens ??= lerMensagens(db, cliente, opcoes).finally(() => { lendoMensagens = null; });
  return lendoMensagens;
}

/** Botão "Ler este edital com IA" de uma licitação (só para negócios do usuário). */
export function tecladoDaLicitacao(negocioId, { appUrl = config.appUrl } = {}) {
  const linhas = [];
  if (negocioId) linhas.push([{ text: '📖 Ler este edital com IA', callback_data: `ler:${negocioId}` }]);
  if (negocioId && /^https:\/\//.test(appUrl ?? '')) linhas.push([{ text: 'Abrir no Busca Pregão IA', url: `${appUrl}/#/negocios/${negocioId}` }]);
  return linhas.length ? linhas : null;
}

async function tratarBotao(db, cliente, cb, { aoPedirLeitura, log }) {
  const chatId = cb.message?.chat?.id;
  const usr = chatId ? db.prepare('SELECT id FROM usuarios WHERE telegram_chat_id = ?').get(String(chatId)) : null;
  const m = String(cb.data ?? '').match(/^ler:(\d+)$/);
  if (!usr || !m) return cliente.responderBotao(cb.id, 'Esta conversa não está ligada a uma conta do Busca Pregão IA.');
  const neg = db.prepare('SELECT id, titulo, oportunidade_id FROM negocios WHERE id = ? AND usuario_id = ?').get(Number(m[1]), usr.id);
  if (!neg?.oportunidade_id) return cliente.responderBotao(cb.id, 'Não achei este negócio (pode ter sido apagado).');
  if (!aoPedirLeitura) return cliente.responderBotao(cb.id, 'A leitura com IA não está disponível agora.');
  await cliente.responderBotao(cb.id, '📖 Lendo o edital... o resultado chega aqui em 1 a 2 minutos.');
  // Não espera: a leitura demora e as outras mensagens continuam sendo atendidas.
  Promise.resolve(aoPedirLeitura({ uid: usr.id, negocioId: neg.id, chatId, titulo: neg.titulo }))
    .catch((e) => log(`[telegram] leitura ${neg.id}: ${e.message}`));
}

async function lerMensagens(db, cliente, { log = () => {}, aoPedirLeitura = null } = {}) {
  const offset = Number(db.prepare("SELECT ultima_execucao FROM tarefas WHERE nome = 'telegram_offset'").get()?.ultima_execucao ?? 0);
  const ups = await cliente.atualizacoes(offset || undefined);
  let ligados = 0;
  for (const u of ups) {
    db.prepare("INSERT OR REPLACE INTO tarefas (nome, ultima_execucao) VALUES ('telegram_offset', ?)").run(String(u.update_id + 1));
    if (u.callback_query) {
      try { await tratarBotao(db, cliente, u.callback_query, { aoPedirLeitura, log }); } catch (e) { log(`[telegram] botão ${u.update_id}: ${e.message}`); }
      continue;
    }
    const m = u.message;
    if (!m?.text || !m.chat?.id) continue;
    const [cmd, arg] = m.text.trim().split(/\s+/);
    try {
      if (cmd === '/start' && arg) {
        const usr = db.prepare('SELECT id, nome FROM usuarios WHERE telegram_codigo = ?').get(arg);
        if (!usr) {
          const jaLigado = db.prepare('SELECT 1 FROM usuarios WHERE telegram_chat_id = ?').get(String(m.chat.id));
          await cliente.enviarTexto(m.chat.id, jaLigado
            ? '✅ Este Telegram já está conectado ao Busca Pregão IA.'
            : 'Código inválido ou já usado. Gere um novo link na página <b>Agentes</b> do Busca Pregão IA.');
          continue;
        }
        db.prepare(`UPDATE usuarios SET telegram_chat_id = ?, telegram_ativo = 1, telegram_codigo = NULL,
          telegram_desde = datetime('now') WHERE id = ?`).run(String(m.chat.id), usr.id);
        ligados++;
        await cliente.enviarTexto(m.chat.id, `✅ Pronto, ${esc(usr.nome)}! Os avisos dos seus agentes e os editais das licitações vão chegar por aqui.\n\nPara parar, envie /parar.`);
      } else if (cmd === '/parar') {
        const r = db.prepare('UPDATE usuarios SET telegram_ativo = 0 WHERE telegram_chat_id = ?').run(String(m.chat.id));
        await cliente.enviarTexto(m.chat.id, r.changes ? 'Avisos desligados. Para ligar de novo, use a página Agentes do Busca Pregão IA.' : 'Esta conversa não está ligada a nenhuma conta.');
      } else if (cmd === '/start') {
        await cliente.enviarTexto(m.chat.id, 'Olá! Para receber os avisos, abra a página <b>Agentes</b> do Busca Pregão IA e clique em <b>Conectar Telegram</b>.');
      }
    } catch (e) {
      log(`[telegram] mensagem ${u.update_id}: ${e.message}`);
    }
  }
  return ligados;
}

export async function enviarEditalTelegram(db, cliente, uid, oportunidadeId, { fetchImpl = fetch, appUrl, negocioId = null, comPdf = true, novo = false } = {}) {
  const u = db.prepare('SELECT telegram_chat_id, telegram_ativo FROM usuarios WHERE id = ?').get(uid);
  if (!u?.telegram_chat_id || !u.telegram_ativo) throw Object.assign(new Error('Conecte o Telegram na página Agentes primeiro.'), { statusCode: 400 });
  // Licitação no funil: vai com o botão para ler o edital com IA.
  const negocio = negocioId ?? db.prepare('SELECT id FROM negocios WHERE usuario_id = ? AND oportunidade_id = ?').get(uid, oportunidadeId)?.id ?? null;
  const teclado = tecladoDaLicitacao(negocio, { appUrl: appUrl ?? config.appUrl });
  const { op, titulo, texto, pdf } = await montarEnvioEdital(db, oportunidadeId, { fetchImpl, appUrl, semPdf: !comPdf });
  const cabeca = novo ? '🆕 <b>Nova licitação na sua triagem</b>\n' : '';
  const legenda = `${cabeca}📄 <b>${esc(corta(titulo, 300))}</b>\n\n${esc(texto).replace(/ · /g, '\n')}`;
  if (pdf && comPdf) {
    await cliente.enviarDocumento(u.telegram_chat_id, { bytes: pdf.bytes, nomeArquivo: pdf.nome, legenda, teclado });
    return { documento: true, arquivo: pdf.nome };
  }
  const rodape = comPdf ? `\n\nO edital não está em PDF no PNCP: ${esc(op.link_pncp ?? '')}` : (op.link_pncp ? `\n\n<a href="${esc(op.link_pncp)}">Edital no PNCP</a>` : '');
  await cliente.enviarTexto(u.telegram_chat_id, `${legenda}${rodape}`, { teclado });
  return { documento: false };
}

export async function processarFilaTelegram(db, { cliente = clienteTelegram(), fetchImpl = fetch, log = () => {}, limite = 15 } = {}) {
  if (!cliente) return 0;
  const pend = db.prepare(`SELECT f.* FROM whatsapp_fila f JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.canal = 'telegram' AND f.enviado_em IS NULL AND f.tentativas < 3 AND u.telegram_ativo = 1 AND f.criado_em >= datetime('now', '-2 days')
    ORDER BY f.id LIMIT ?`).all(limite);
  let n = 0;
  for (const f of pend) {
    try {
      const r = await enviarEditalTelegram(db, cliente, f.usuario_id, f.oportunidade_id, { fetchImpl, negocioId: f.negocio_id, comPdf: f.com_pdf !== 0, novo: f.origem === 'prospector' });
      db.prepare("UPDATE whatsapp_fila SET enviado_em = datetime('now'), tentativas = tentativas + 1, resultado = ? WHERE id = ?").run(JSON.stringify(r), f.id);
      n++;
    } catch (e) {
      const definitivo = e.status >= 400 && e.status < 500;
      db.prepare('UPDATE whatsapp_fila SET tentativas = ?, resultado = ? WHERE id = ?').run(definitivo ? 3 : f.tentativas + 1, JSON.stringify({ erro: e.message }), f.id);
      log(`[telegram] edital ${f.oportunidade_id}: ${e.message}`);
    }
  }
  return n;
}

export async function enviarNotificacoesPorTelegram(db, { cliente = clienteTelegram(), querTelegram = () => true, appUrl = config.appUrl, log = () => {} } = {}) {
  if (!cliente) return 0;
  const pend = db.prepare(`SELECT n.*, u.telegram_chat_id FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id
    WHERE n.enviada_telegram = 0 AND u.telegram_ativo = 1 AND u.telegram_chat_id IS NOT NULL
      AND n.criado_em >= coalesce(u.telegram_desde, datetime('now')) AND n.criado_em >= datetime('now', '-1 day')
    ORDER BY n.id LIMIT 50`).all();
  let n = 0;
  for (const x of pend) {
    let marca = 2;
    if (querTelegram(x)) {
      try {
        const link = x.link ? `\n\n<a href="${esc(`${appUrl}/#${x.link}`)}">Abrir no Busca Pregão IA</a>` : '';
        await cliente.enviarTexto(x.telegram_chat_id, `🔔 <b>${esc(x.titulo)}</b>${x.mensagem ? `\n\n${esc(x.mensagem)}` : ''}${link}`);
        marca = 1;
        n++;
      } catch (e) {
        log(`[telegram] aviso ${x.id}: ${e.message}`);
        if (!(e.status >= 400 && e.status < 500)) continue;
        // Usuário bloqueou o robô: desliga para não insistir.
        if (e.status === 403) db.prepare('UPDATE usuarios SET telegram_ativo = 0 WHERE id = ?').run(x.usuario_id);
        marca = 3;
      }
    }
    db.prepare('UPDATE notificacoes SET enviada_telegram = ? WHERE id = ?').run(marca, x.id);
  }
  return n;
}
