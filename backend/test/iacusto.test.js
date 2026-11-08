import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { custoUsd } = await import('../src/services/iaCusto.js');
const { checarLimite, registrarUso } = await import('../src/services/editalIA.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');

const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('custo de cada uso pelos preços oficiais', () => {
  // 100 mil tokens de entrada + 5 mil de saída no Opus 5.5 = 0,40 + 0,10
  perto(custoUsd({ modelo: 'claude-opus-5-5', input_tokens: 100000, output_tokens: 5000 }), 0.5);
  // Cache: escrita 1,25x a entrada; leitura US$ 0,20/M
  perto(custoUsd({ modelo: 'claude-opus-5-5', cache_write_tokens: 100000, cache_read_tokens: 100000 }), 0.5 + 0.02);
  perto(custoUsd({ modelo: 'claude-fable-5-1', input_tokens: 1e6 }), 10);
  perto(custoUsd({ modelo: null, input_tokens: 1e6 }), 4, 'registros antigos sem modelo: Opus 5.5');
});

test('painel Uso da IA: totais, por edital e limite mensal que pausa novas análises', async () => {
  const db = openDatabase(':memory:');
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: 'X-1', objetoCompra: 'Material de limpeza', modalidadeId: 6, anoCompra: 2026, sequencialCompra: 1,
    srp: false, dataPublicacaoPncp: '2026-11-01T10:00:00', dataEncerramentoProposta: '2099-11-18T09:00:00', orgaoEntidade: { cnpj: '1', razaoSocial: 'PREFEITURA X' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } })]);
  const op = db.prepare('SELECT id FROM oportunidades').get().id;
  const app = await buildApp({ db, serveFrontend: false, ia: null, whatsapp: null, telegram: null });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'c@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  const uid = db.prepare('SELECT id FROM usuarios').get().id;

  registrarUso(db, uid, 'resumo', { input_tokens: 100000, output_tokens: 5000 }, { modelo: 'claude-opus-5-5', referencia: `op:${op}` });
  registrarUso(db, uid, 'pergunta', { input_tokens: 200, cache_read_input_tokens: 100000, output_tokens: 1000 }, { modelo: 'claude-opus-5-5', referencia: `op:${op}` });
  let p = (await req('GET', '/api/ia/uso')).json();
  perto(p.totalMes.usd, 0.5 + (200 * 4 + 100000 * 0.2 + 1000 * 20) / 1e6);
  perto(p.mediaPorEdital, 0.5);
  assert.equal(p.leiturasEdital, 1);
  assert.equal(p.itens[1].titulo, 'Material de limpeza');
  assert.equal(p.itens[1].detalhe, 'PREFEITURA X · Campinas/SP');
  assert.equal(p.itens[1].tipoNome, 'Leitura do edital');
  assert.equal(p.cotacaoDolar, 5.5);
  assert.equal(p.porDia.length, 1);

  assert.equal((await req('PUT', '/api/ia/config', { limiteMensalUsd: 0.4, cotacaoDolar: 5.2 })).statusCode, 200);
  p = (await req('GET', '/api/ia/uso')).json();
  assert.deepEqual([p.limiteMensalUsd, p.cotacaoDolar, p.usoDoLimite], [0.4, 5.2, 1]);
  assert.throws(() => checarLimite(db, uid), (e) => e.statusCode === 429 && /limite de gasto com IA deste mês/.test(e.message));
  await req('PUT', '/api/ia/config', { limiteMensalUsd: null });
  assert.doesNotThrow(() => checarLimite(db, uid));
});
