import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { mapContrato, gravarContratos } = await import('../src/services/historico.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { atualizarOrgaos, enteDoOrgao } = await import('../src/services/orgaos.js');

test('página de órgãos: resumo de 12 meses, Pagômetro, busca, perfil e órgãos dos negócios', async () => {
  const db = openDatabase(':memory:');
  const hoje = new Date().toISOString().slice(0, 10);
  const ct = (i, orgao, nome, esfera, uf, mun, ibge, forn, valor) => mapContrato({
    numeroControlePNCP: `${orgao}-2-00000${i}/2026`, numeroControlePncpCompra: `${orgao}-1-00000${i}/2026`, objetoContrato: `Compra ${i}`, valorGlobal: valor,
    niFornecedor: forn[0], nomeRazaoSocialFornecedor: forn[1], orgaoEntidade: { cnpj: orgao, razaoSocial: nome, esferaId: esfera },
    unidadeOrgao: { ufSigla: uf, municipioNome: mun, codigoIbge: ibge }, categoriaProcesso: { nome: 'Compras' }, dataAssinatura: hoje, dataPublicacaoPncp: `${hoje}T10:00:00` });
  const A = ['11222333000181', 'LIMPA TUDO'];
  const B = ['22222222000122', 'BETA'];
  gravarContratos(db, [
    ct(1, '46068425000133', 'MUNICIPIO DE CAMPINAS', 'M', 'SP', 'Campinas', '3509502', A, 5000),
    ct(2, '46068425000133', 'MUNICIPIO DE CAMPINAS', 'M', 'SP', 'Campinas', '3509502', B, 2000),
    ct(3, '46068425000133', 'MUNICIPIO DE CAMPINAS', 'M', 'SP', 'Campinas', '3509502', A, 1000),
    ct(4, '00394460000141', 'MINISTERIO DA SAUDE', 'F', 'DF', 'Brasília', '5300108', B, 90000),
  ]);
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '46068425000133-1-000099/2026', objetoCompra: 'Material de limpeza', modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico',
    anoCompra: 2026, sequencialCompra: 99, srp: false, dataPublicacaoPncp: f(-1), dataEncerramentoProposta: f(5), valorTotalEstimado: 3000,
    orgaoEntidade: { cnpj: '46068425000133', razaoSocial: 'MUNICIPIO DE CAMPINAS', esferaId: 'M' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas', codigoIbge: '3509502' } })]);
  db.prepare("INSERT INTO capag_entes (tipo, codigo, nome, nome_norm, uf, capag, nota3, atualizado_em) VALUES ('municipio', '3509502', 'Campinas', 'campinas', 'SP', 'A', 'A', 'x')").run();

  assert.equal(atualizarOrgaos(db), 2);
  assert.deepEqual(enteDoOrgao({ nome: 'MUNICIPIO DE CAMPINAS', esfera: 'M', municipio: 'Campinas', uf: 'SP' }), { ente: 'Município de Campinas/SP', proprioEnte: true });
  assert.deepEqual(enteDoOrgao({ nome: 'SECRETARIA DE SAUDE', esfera: 'E', uf: 'BA' }), { ente: 'Estado (BA)', proprioEnte: false });

  const app = await buildApp({ db, serveFrontend: false, ia: null, whatsapp: null, telegram: null });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'o@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const get = async (url) => (await app.inject({ method: 'GET', url, headers: { cookie } })).json();

  let l = await get('/api/orgaos');
  assert.deepEqual(l.itens.map((o) => [o.nome, o.valor12m]), [['MINISTERIO DA SAUDE', 90000], ['MUNICIPIO DE CAMPINAS', 8000]]);
  const camp = l.itens[1];
  assert.deepEqual([camp.contratos12m, camp.licitacoes12m, camp.abertas, camp.pagometro.nivel, camp.pagometro.nota, camp.proprioEnte], [3, 1, 1, 'baixo', 'A', true]);
  assert.equal(l.itens[0].pagometro.nivel, 'federal');
  assert.deepEqual((await get('/api/orgaos?q=campinas')).itens.map((o) => o.cnpj), ['46068425000133']);
  assert.deepEqual((await get('/api/orgaos?q=4606')).itens.map((o) => o.cnpj), ['46068425000133']);
  assert.deepEqual((await get('/api/orgaos?esfera=F')).itens.map((o) => o.cnpj), ['00394460000141']);
  assert.equal((await get('/api/orgaos?uf=RJ')).total, 0);

  const p = await get('/api/orgaos/46068425000133');
  assert.equal(p.nome, 'MUNICIPIO DE CAMPINAS');
  assert.deepEqual(p.fornecedores.map((x) => [x.nome, x.valor, x.contratos]), [['LIMPA TUDO', 6000, 2], ['BETA', 2000, 1]]);
  assert.equal(p.abertas[0].objeto, 'Material de limpeza');
  assert.equal(p.porMes.length, 1);
  assert.equal(p.recentes.length, 3);
  assert.equal((await app.inject({ method: 'GET', url: '/api/orgaos/99999999000199', headers: { cookie } })).statusCode, 404);

  const op = db.prepare('SELECT id FROM oportunidades').get().id;
  await app.inject({ method: 'POST', url: '/api/negocios', payload: { oportunidade_id: op }, headers: { cookie } });
  assert.deepEqual((await get('/api/orgaos')).meus.map((m) => m.nome), ['MUNICIPIO DE CAMPINAS']);
});
