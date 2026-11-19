import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { avisarDocumentosVencendo, marcoDoDocumento } = await import('../src/services/avisosDocumentos.js');
const { enviarNotificacoesPorTelegram } = await import('../src/services/telegram.js');
const { querTelegram } = await import('../src/services/agentes.js');

test('marcos de vencimento', () => {
  const h = '2026-11-19';
  assert.equal(marcoDoDocumento('2026-12-30', h), null, 'longe');
  assert.deepEqual(marcoDoDocumento('2026-12-19', h), { marco: 30, dias: 30 });
  assert.deepEqual(marcoDoDocumento('2026-11-29', h), { marco: 15, dias: 10 });
  assert.deepEqual(marcoDoDocumento('2026-11-26', h), { marco: 7, dias: 7 });
  assert.deepEqual(marcoDoDocumento('2026-11-20', h), { marco: 1, dias: 1 });
  assert.deepEqual(marcoDoDocumento('2026-11-19', h), { marco: 0, dias: 0 });
  assert.deepEqual(marcoDoDocumento('2026-11-10', h), { marco: -1, dias: -9 });
  assert.equal(marcoDoDocumento('2026-09-01', h), null, 'vencido há muito tempo não avisa');
});

test('avisa no sino e no Telegram, uma vez por marco, agrupado por usuário', async () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, telegram_chat_id, telegram_ativo, telegram_desde) VALUES ('M', 'm@e.com', 'x', '777', 1, datetime('now', '-1 day'))").run();
  const uid = db.prepare('SELECT id FROM usuarios').get().id;
  const doc = db.prepare('INSERT INTO documentos (usuario_id, nome, categoria, validade) VALUES (?, ?, ?, ?)');
  doc.run(uid, 'CRF FGTS', 'fgts', '2026-11-26');
  doc.run(uid, 'CND Federal', 'certidao_federal', '2026-11-20');
  doc.run(uid, 'Contrato social', 'contrato_social', null);
  doc.run(uid, 'Alvará', 'alvara', '2027-05-01');
  db.prepare("INSERT INTO negocios (usuario_id, titulo, etapa, data_disputa) VALUES (?, 'Pregão X', 'proposta', '2026-12-01T09:00')").run(uid);

  assert.equal(avisarDocumentosVencendo(db, '2026-11-19'), 1);
  const n = db.prepare("SELECT * FROM notificacoes WHERE agente = 'documentos'").all();
  assert.equal(n.length, 1, 'um aviso agrupado');
  assert.match(n[0].titulo, /2 documentos perto de vencer \(1 urgente/);
  assert.match(n[0].mensagem, /CND Federal: vence AMANHÃ \(20\/11\/2026\)/);
  assert.match(n[0].mensagem, /CRF FGTS: vence em 7 dias/);
  assert.match(n[0].mensagem, /1 negócio\(s\) ativo/);
  assert.doesNotMatch(n[0].mensagem, /Alvará|Contrato social/);

  assert.equal(avisarDocumentosVencendo(db, '2026-11-19'), 0, 'não repete no mesmo marco');
  assert.equal(avisarDocumentosVencendo(db, '2026-11-20'), 1, 'CND entra no marco "hoje"');
  assert.match(db.prepare("SELECT mensagem FROM notificacoes WHERE agente = 'documentos' ORDER BY id DESC").get().mensagem, /CND Federal: vence HOJE/);

  const enviados = [];
  const telegram = { enviarTexto: async (chat, html) => { enviados.push({ chat, html }); } };
  db.prepare("UPDATE notificacoes SET criado_em = datetime('now')").run();
  assert.equal(await enviarNotificacoesPorTelegram(db, { cliente: telegram, querTelegram: querTelegram(db), appUrl: 'https://app.x' }), 2);
  assert.equal(enviados[0].chat, '777');
  assert.match(enviados[0].html, /documentos perto de vencer/);
  assert.match(enviados[0].html, /#\/documentos/);
});
