import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { mapContrato, gravarContratos } = await import('../src/services/historico.js');

const ct = (i, objeto, forn, orgao, uf, esfera, valor, pub) => mapContrato({
  numeroControlePNCP: `M-${i}`, objetoContrato: objeto, valorGlobal: valor, niFornecedor: forn[0], nomeRazaoSocialFornecedor: forn[1],
  orgaoEntidade: { cnpj: orgao, razaoSocial: `ORGAO ${orgao}`, esferaId: esfera }, unidadeOrgao: { ufSigla: uf },
  categoriaProcesso: { nome: 'Compras' }, dataAssinatura: pub, dataPublicacaoPncp: `${pub}T10:00:00`,
});
const A = ['11111111000111', 'ALFA'];
const B = ['22222222000122', 'BETA'];
const C = ['33333333000133', 'GAMA'];

test('análise de mercado: totais, mediana, concentração, contrato dominante e perfil de empresa', async () => {
  const db = openDatabase(':memory:');
  gravarContratos(db, [
    ct(1, 'Material de limpeza', A, '1', 'SP', 'M', 100, '2026-11-02'),
    ct(2, 'Material de limpeza', A, '2', 'SP', 'M', 200, '2026-11-03'),
    ct(3, 'Material de limpeza', B, '3', 'MG', 'E', 300, '2026-11-03'),
    ct(4, 'Material de limpeza hospitalar', C, '4', 'RJ', 'F', 10000, '2026-10-26'),
    ct(5, 'Material de limpeza', B, '1', 'SP', 'M', 0, '2026-11-03'), // valor zerado: fora das somas
    ct(6, 'Notebooks', C, '5', 'SP', 'M', 5000, '2026-11-03'),
  ]);
  db.prepare("INSERT INTO contratos_dias VALUES ('2026-11-03', 6, '2026-11-04 00:00:00')").run();
  const app = await buildApp({ db, serveFrontend: false, ia: null });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'm@e.com', senha: 'senha-segura-1' } });
  const cookie = cad.headers['set-cookie'].split(';')[0];
  const get = async (url) => (await app.inject({ method: 'GET', url, headers: { cookie } })).json();

  const m = await get('/api/mercado?q=limpeza');
  assert.deepEqual(
    { c: m.resumo.contratos, v: m.resumo.valor, f: m.resumo.fornecedores, med: m.resumo.ticketMediano },
    { c: 4, v: 10600, f: 3, med: 250 },
  );
  assert.equal(m.fornecedores[0].nome, 'GAMA');
  assert.equal(m.fornecedoresPorContratos[0].nome, 'ALFA');
  assert.equal(m.fornecedoresPorContratos[0].participacaoContratos, 0.5);
  assert.equal(m.contratoDominante.fornecedor, 'GAMA');
  assert.deepEqual(m.porSemana.map((s) => s.semana), ['2026-10-26', '2026-11-02']);
  assert.deepEqual(m.porEsfera.map((e) => e.nome), ['Federal', 'Estadual', 'Municipal']);
  assert.equal(m.concentracao.porValor.nivel, 'alta');

  const sp = await get('/api/mercado?q=limpeza&uf=SP');
  assert.equal(sp.resumo.contratos, 2);

  const e = await get(`/api/mercado/empresa/${A[0]}?q=limpeza`);
  assert.equal(e.nome, 'ALFA');
  assert.equal(e.resumo.contratos, 2);
  assert.equal(Math.round(e.participacaoNoMercado * 1000) / 1000, Math.round((300 / 10600) * 1000) / 1000);
  assert.equal(e.clientes.length, 2);
  assert.equal((await app.inject({ method: 'GET', url: '/api/mercado/empresa/123', headers: { cookie } })).statusCode, 400);
});

test('período, meses em consolidação e rankings paginados', async () => {
  const { analisarMercado, rankingMercado } = await import('../src/services/mercado.js');
  const db = openDatabase(':memory:');
  const hoje = new Date().toISOString().slice(0, 10);
  gravarContratos(db, [
    ct(11, 'Limpeza', A, '1', 'SP', 'M', 100, '2026-01-10'),
    ct(12, 'Limpeza', B, '2', 'MG', 'E', 200, '2026-03-05'),
    ct(13, 'Limpeza', B, '3', 'MG', 'E', 300, hoje),
  ]);
  const m = analisarMercado(db, { q: 'limpeza' });
  assert.deepEqual(m.porMes.map((x) => [x.mes, x.consolidando]), [['2026-01', false], ['2026-03', false], [hoje.slice(0, 7), true]]);
  assert.equal(m.resumo.estados, 2);
  assert.equal(analisarMercado(db, { q: 'limpeza', de: '2026-02-01', ate: '2026-03-31' }).resumo.contratos, 1);
  const r = rankingMercado(db, 'uf', { q: 'limpeza', tamanho: 1 });
  assert.deepEqual([r.total, r.itens[0].chave, r.itens[0].valor], [2, 'MG', 500]);
  assert.equal(rankingMercado(db, 'orgao', { q: 'limpeza', pagina: 2, tamanho: 2 }).itens.length, 1);
  assert.equal(rankingMercado(db, 'xyz', {}), null);
});
