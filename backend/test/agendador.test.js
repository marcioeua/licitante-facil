import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { proximaTarefa, alertasPendentes, agoraBrasilia } = await import('../src/jobs/agendador.js');
const { sincronizarAtualizacoes } = await import('../src/services/pncp.js');

// Horários em UTC; Brasília = UTC-3.
const t = (s) => new Date(s + 'Z');
const sync = (db, tipo, inicio, erro = null) => db.prepare(
  'INSERT INTO sincronizacoes (tipo, iniciado_em, finalizado_em, erro) VALUES (?, ?, ?, ?)').run(tipo, inicio, inicio, erro);

test('horário de Brasília', () => {
  assert.deepEqual(agoraBrasilia(t('2026-11-04T02:30:00')), { data: '2026-11-03', hora: 23, minuto: 30 });
});

test('banco vazio pede carga completa; falha só tenta de novo após 2h', () => {
  const db = openDatabase(':memory:');
  assert.equal(proximaTarefa(db, t('2026-11-04T15:00:00')).tipo, 'completa');
  sync(db, 'completa', '2026-11-04 15:00:00', 'PNCP fora do ar');
  assert.equal(proximaTarefa(db, t('2026-11-04T16:00:00')), null);
  assert.equal(proximaTarefa(db, t('2026-11-04T17:01:00')).tipo, 'completa');
});

test('incremental a cada 2h e completa na madrugada', () => {
  const db = openDatabase(':memory:');
  sync(db, 'completa', '2026-11-04 12:00:00');
  assert.equal(proximaTarefa(db, t('2026-11-04T13:00:00')), null);
  const inc = proximaTarefa(db, t('2026-11-04T14:05:00'));
  assert.equal(inc.tipo, 'incremental');
  sync(db, 'incremental', '2026-11-04 14:05:00');
  assert.equal(proximaTarefa(db, t('2026-11-04T15:00:00')), null);
  // 03h10 em Brasília do dia seguinte = 06h10 UTC
  assert.equal(proximaTarefa(db, t('2026-11-05T06:10:00')).tipo, 'completa');
});

test('alertas uma vez por dia depois das 7h30', () => {
  const db = openDatabase(':memory:');
  assert.equal(alertasPendentes(db, t('2026-11-04T10:00:00')), false); // 7h00 BR
  assert.equal(alertasPendentes(db, t('2026-11-04T10:31:00')), true); // 7h31 BR
  db.prepare("INSERT INTO tarefas VALUES ('alertas', '2026-11-04')").run();
  assert.equal(alertasPendentes(db, t('2026-11-04T20:00:00')), false);
});

test('incremental ignora compras novas já encerradas, mas atualiza as conhecidas', async () => {
  const db = openDatabase(':memory:');
  const reg = (seq, enc, obj) => ({ numeroControlePNCP: `X-${seq}`, objetoCompra: obj, modalidadeId: 6, anoCompra: 2026, sequencialCompra: seq, dataEncerramentoProposta: enc, orgaoEntidade: { cnpj: '1' }, unidadeOrgao: {} });
  db.prepare("INSERT INTO oportunidades (numero_controle_pncp, objeto) VALUES ('X-2', 'antigo')").run();
  const fake = async (url) => (new URL(url).searchParams.get('codigoModalidadeContratacao') === '6'
    ? Response.json({ data: [reg(1, '2020-01-01T10:00:00', 'nova encerrada'), reg(2, '2020-01-01T10:00:00', 'conhecida atualizada'), reg(3, '2099-01-01T10:00:00', 'nova aberta')], paginasRestantes: 0 })
    : new Response(null, { status: 204 }));
  const r = await sincronizarAtualizacoes(db, { fetchImpl: fake, log: () => {}, pausaMs: 0 });
  assert.equal(r.importadas, 2);
  assert.deepEqual(db.prepare('SELECT numero_controle_pncp, objeto FROM oportunidades ORDER BY 1').all().map((x) => ({ ...x })),
    [{ numero_controle_pncp: 'X-2', objeto: 'conhecida atualizada' }, { numero_controle_pncp: 'X-3', objeto: 'nova aberta' }]);
  assert.equal(db.prepare('SELECT tipo FROM sincronizacoes').get().tipo, 'incremental');
});

test('carga interrompida por reinício é retomada sem esperar 2h', async () => {
  const { marcarInterrompidas } = await import('../src/jobs/agendador.js');
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO sincronizacoes (tipo, iniciado_em) VALUES ('completa', '2026-11-04 15:00:00')").run();
  assert.equal(marcarInterrompidas(db), 1);
  assert.equal(proximaTarefa(db, t('2026-11-04T15:10:00')).tipo, 'completa');
});
