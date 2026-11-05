import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { sugerirLance, precoMinimo } = await import('../src/services/disputa.js');

test('cálculo do lance: mínimo, cobrir o melhor, parar e decremento em %', () => {
  const base = { custo: 80, margem_minima: 0.1, valor_estimado: 120, decremento: 0.5, decremento_tipo: 'valor', situacao: 'disputando' };
  assert.equal(precoMinimo(base), 88);
  assert.deepEqual([sugerirLance(base).estado, sugerirLance(base).valor], ['inicial', 120]);
  assert.deepEqual([sugerirLance({ ...base, melhor_lance: 100 }).estado, sugerirLance({ ...base, melhor_lance: 100 }).valor], ['cobrir', 99.5]);
  assert.equal(sugerirLance({ ...base, melhor_lance: 88.3 }).estado, 'parar');
  assert.equal(sugerirLance({ ...base, melhor_lance: 95, meu_lance: 95 }).estado, 'ganhando');
  assert.equal(sugerirLance({ ...base, melhor_lance: 100, decremento: 0.01, decremento_tipo: 'pct' }).valor, 99);
  assert.equal(sugerirLance({ ...base, melhor_lance: 100, decremento: null }).valor, 99.99, 'sem decremento: 1 centavo');
  assert.equal(sugerirLance({ custo: 0.3, margem_minima: 0, melhor_lance: 0.4567, situacao: 'disputando' }).valor, 0.4566, 'itens baratos: 4 casas');
  assert.equal(sugerirLance({ ...base, situacao: 'desisti', melhor_lance: 100 }).estado, 'encerrado');
});

test('sala de disputa: importa itens do PNCP, registra lances, desfaz e protege outros usuários', async () => {
  const db = openDatabase(':memory:');
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '11222333000181-1-000045/2026', objetoCompra: 'Material de limpeza', modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico',
    anoCompra: 2026, sequencialCompra: 45, srp: false, dataPublicacaoPncp: f(-1), dataEncerramentoProposta: f(5), valorTotalEstimado: 5000,
    orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } })]);
  const opId = db.prepare('SELECT id FROM oportunidades').get().id;
  const urls = [];
  const fetchPncp = async (url) => {
    urls.push(String(url));
    return Response.json([
      { numeroItem: 1, descricao: 'Detergente líquido 500 ml', unidadeMedida: 'Frasco', quantidade: 200, valorUnitarioEstimado: 3.5 },
      { numeroItem: 2, descricao: 'Água sanitária 1 L', unidadeMedida: 'Litro', quantidade: 100, valorUnitarioEstimado: 4.2 },
    ]);
  };
  const app = await buildApp({ db, serveFrontend: false, ia: null, fetchImpl: fetchPncp });
  const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email, senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const cookie = await login('d@e.com');
  const outro = await login('o@e.com');
  const req = (method, url, payload, c = cookie) => app.inject({ method, url, payload, headers: { cookie: c } });

  const neg = (await req('POST', '/api/negocios', { oportunidade_id: opId })).json();
  let r = await req('POST', `/api/disputa/negocio/${neg.id}/importar`);
  assert.deepEqual(r.json(), { importados: 2, total: 2 });
  assert.match(urls[0], /\/api\/pncp\/v1\/orgaos\/11222333000181\/compras\/2026\/45\/itens/);
  assert.equal((await req('POST', `/api/disputa/negocio/${neg.id}/importar`)).json().importados, 0, 'não duplica');

  let sala = (await req('GET', `/api/disputa/negocio/${neg.id}`)).json();
  assert.equal(sala.negocio.orgao_nome, 'PREFEITURA');
  const det = sala.itens[0];
  assert.deepEqual([det.numero_item, det.valor_estimado, det.sugestao.estado], [1, 3.5, 'inicial']);

  r = await req('PATCH', `/api/disputa/itens/${det.id}`, { custo: 2, margem_minima: 0.2, decremento: 0.05 });
  assert.equal(r.json().preco_minimo, 2.4);
  r = await req('POST', `/api/disputa/itens/${det.id}/lances`, { tipo: 'melhor', valor: 3.1 });
  assert.deepEqual([r.json().situacao, r.json().sugestao.valor], ['disputando', 3.05]);
  r = await req('POST', `/api/disputa/itens/${det.id}/lances`, { tipo: 'meu', valor: 3.05 });
  assert.deepEqual([r.json().melhor_lance, r.json().sugestao.estado], [3.05, 'ganhando']);
  r = await req('POST', `/api/disputa/itens/${det.id}/lances`, { tipo: 'melhor', valor: 2.42 });
  assert.equal(r.json().sugestao.estado, 'parar');
  r = await req('DELETE', `/api/disputa/itens/${det.id}/lances/ultimo`);
  assert.deepEqual([r.json().melhor_lance, r.json().meu_lance, r.json().lances.length], [3.05, 3.05, 2]);

  r = await req('POST', `/api/disputa/negocio/${neg.id}/itens`, { descricao: 'Item extra', custo: 10 });
  assert.equal(r.statusCode, 201);
  assert.equal((await req('PATCH', `/api/disputa/itens/${det.id}`, { custo: 1 }, outro)).statusCode, 404);
  assert.equal((await req('GET', `/api/disputa/negocio/${neg.id}`, null, outro)).statusCode, 404);
  assert.equal((await req('POST', `/api/disputa/itens/${det.id}/lances`, { tipo: 'melhor', valor: -1 })).statusCode, 400);
  await req('DELETE', `/api/negocios/${neg.id}`);
  assert.equal(db.prepare('SELECT count(*) n FROM disputa_itens').get().n, 0, 'apaga junto com o negócio');
});
