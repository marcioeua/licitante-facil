import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');

test('conector MCP: link pessoal, ferramentas e filtro "sem atestado"', async () => {
  const db = openDatabase(':memory:');
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  const base = { modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, srp: false, dataPublicacaoPncp: f(-1), dataEncerramentoProposta: f(5), orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA' } };
  upsertOportunidades(db, [
    { ...base, numeroControlePNCP: 'A', objetoCompra: 'Material de limpeza', sequencialCompra: 1, valorTotalEstimado: 30000, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } },
    { ...base, numeroControlePNCP: 'B', objetoCompra: 'Material de limpeza e higiene', sequencialCompra: 2, valorTotalEstimado: 45000, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Santos' } },
    { ...base, numeroControlePNCP: 'C', objetoCompra: 'Limpeza predial', sequencialCompra: 3, valorTotalEstimado: 48000, unidadeOrgao: { ufSigla: 'MG', municipioNome: 'Uberaba' } },
    { ...base, numeroControlePNCP: 'D', objetoCompra: 'Material de limpeza', sequencialCompra: 4, valorTotalEstimado: 80000, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } },
  ].map(mapContratacao));
  const id = (n) => db.prepare('SELECT id FROM oportunidades WHERE numero_controle_pncp = ?').get(n).id;
  const resumo = (n, r) => db.prepare("INSERT INTO edital_resumos (oportunidade_id, resumo, modelo) VALUES (?, ?, 'x')").run(id(n), JSON.stringify(r));
  resumo('A', { objeto: 'Limpeza', documentos_habilitacao: [], qualificacao_tecnica: { exige_atestado: 'nao', detalhe: 'Dispensada (art. 70, III)' } });
  resumo('B', { objeto: 'Limpeza', documentos_habilitacao: [{ grupo: 'tecnica', descricao: 'Atestado de capacidade técnica de 30%' }] });

  const app = await buildApp({ db, serveFrontend: false, ia: null });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'c@e.com', senha: 'senha-segura-1' } });
  assert.equal(cad.statusCode, 200, cad.body);
  const cookie = cad.headers['set-cookie'].split(';')[0];
  assert.equal((await app.inject({ method: 'GET', url: '/api/conector', headers: { cookie } })).json().ativo, false);
  const { token } = (await app.inject({ method: 'POST', url: '/api/conector', headers: { cookie } })).json();
  assert.ok(token.length >= 30);

  const rpc = async (method, params, t = token) => app.inject({ method: 'POST', url: `/mcp/${t}`, headers: { host: 'app.exemplo.com.br', 'x-forwarded-proto': 'https' }, payload: { jsonrpc: '2.0', id: 1, method, params } });
  assert.equal((await rpc('tools/list', {}, 'x'.repeat(32))).statusCode, 401);

  const ini = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } })).json();
  assert.equal(ini.result.protocolVersion, '2025-06-18');
  assert.equal(ini.result.serverInfo.name, 'busca-pregao-ia');
  const notif = await app.inject({ method: 'POST', url: `/mcp/${token}`, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(notif.statusCode, 202);

  const tools = (await rpc('tools/list', {})).json().result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['buscar_licitacoes', 'detalhes_licitacao', 'verificar_edital', 'perguntar_edital']);
  assert.equal(tools[0].inputSchema.type, 'object');
  assert.ok(tools[0].inputSchema.properties.valor_max);

  const chamar = async (name, args) => {
    const r = (await rpc('tools/call', { name, arguments: args })).json().result;
    return r.isError ? r : JSON.parse(r.content[0].text);
  };
  // "Licitação de até 50 mil que não exija atestado de capacidade técnica"
  const r = await chamar('buscar_licitacoes', { valor_max: 50000, atestado: 'sem_atestado' });
  assert.deepEqual(r.licitacoes.map((l) => [l.cidade, l.atestado_capacidade_tecnica.situacao]), [['Campinas', 'nao_exige'], ['Uberaba', 'nao_verificado']]);
  assert.equal(r.licitacoes[0].link_busca_pregao, `https://app.exemplo.com.br/#/oportunidades/${id('A')}`);
  assert.deepEqual(r.atestado_por_situacao, { nao_exige: 1, nao_verificado: 1 });

  const com = await chamar('buscar_licitacoes', { valor_max: 50000, atestado: 'com_atestado' });
  assert.deepEqual(com.licitacoes.map((l) => l.cidade), ['Santos']);
  assert.deepEqual((await chamar('buscar_licitacoes', { cidade: 'campinas', texto: 'limpeza' })).licitacoes.map((l) => l.valor_estimado).sort(), [30000, 80000]);
  assert.equal((await chamar('buscar_licitacoes', { cidade: 'Cidade Inexistente' })).total, 0);

  const det = await chamar('detalhes_licitacao', { id: id('B') });
  assert.equal(det.atestado_capacidade_tecnica.situacao, 'exige');
  assert.match(det.atestado_capacidade_tecnica.detalhe, /30%/);
  assert.match((await chamar('detalhes_licitacao', { id: 999999 })).content[0].text, /não encontrada/);
  assert.match((await chamar('verificar_edital', { id: id('C') })).content[0].text, /não está configurada/);
  assert.equal((await chamar('buscar_licitacoes', { valor_max: -5 })).isError, true);
  assert.equal((await rpc('metodo/inexistente', {})).json().error.code, -32601);

  const st = (await app.inject({ method: 'GET', url: '/api/conector', headers: { cookie } })).json();
  assert.equal(st.ativo, true);
  assert.ok(st.chamadas >= 10);
  await app.inject({ method: 'DELETE', url: '/api/conector', headers: { cookie } });
  assert.equal((await rpc('tools/list', {})).statusCode, 401, 'link desativado');
});

test('rotas de descoberta OAuth respondem 404 em JSON (não o index.html)', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { config } = await import('../src/config.js');
  const dir = mkdtempSync(join(tmpdir(), 'spa-'));
  writeFileSync(join(dir, 'index.html'), '<html></html>');
  const antes = config.frontendDist;
  config.frontendDist = dir;
  try {
    const app = await buildApp({ db: openDatabase(':memory:'), ia: null });
    for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/mcp']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 404, url);
      assert.match(r.headers['content-type'], /json/);
    }
    assert.match((await app.inject({ method: 'GET', url: '/qualquer' })).body, /<html>/);
  } finally {
    config.frontendDist = antes;
  }
});

test('site fora dos buscadores: cabeçalho noindex em todas as respostas', async () => {
  const app = await buildApp({ db: openDatabase(':memory:'), serveFrontend: false, ia: null });
  for (const url of ['/api/saude', '/api/oportunidades']) {
    assert.equal((await app.inject({ method: 'GET', url })).headers['x-robots-tag'], 'noindex, nofollow, noarchive', url);
  }
});
