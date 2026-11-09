import { test } from 'node:test';
import assert from 'node:assert/strict';

const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { mapContrato, gravarContratos, importarContratosDoDia, proximoDiaContratos, limparHistoricoAntigo, pesquisarPrecos, _pncpVoltou } = await import('../src/services/historico.js');
const { _definirMedidorDisco: medidor } = await import('../src/services/historico.js');
// Nos testes o disco é simulado (com espaço), para não depender da máquina.
const DISCO_FOLGADO = () => ({ total: 1e6, livre: 1e6, usoPct: 0 });
medidor(DISCO_FOLGADO);

const contrato = (i, objeto, forn, orgao, valor, compra, uf = 'SP') => ({
  numeroControlePNCP: `C-${i}`, numeroControlePncpCompra: compra, objetoContrato: objeto, valorGlobal: valor,
  niFornecedor: forn[0], nomeRazaoSocialFornecedor: forn[1], orgaoEntidade: { cnpj: orgao[0], razaoSocial: orgao[1], esferaId: 'M' },
  unidadeOrgao: { ufSigla: uf, municipioNome: 'Cidade', codigoIbge: '3550308' }, categoriaProcesso: { nome: 'Compras' },
  dataAssinatura: '2026-11-02', dataPublicacaoPncp: '2026-11-03T10:00:00',
});
const FA = ['11111111000111', 'FARMA ALFA LTDA'];
const FB = ['22222222000122', 'DISTRIBUIDORA BETA'];
const P1 = ['33333333000133', 'MUNICIPIO DE UM'];
const P2 = ['44444444000144', 'MUNICIPIO DE DOIS'];

test('mapeia contrato do PNCP', () => {
  const m = mapContrato(contrato(1, 'Aquisição de medicamentos', FA, P1, 1000, '33333333000133-1-000010/2026'));
  assert.equal(m.fornecedor_nome, 'FARMA ALFA LTDA');
  assert.equal(m.compra_controle, '33333333000133-1-000010/2026');
  assert.equal(m.codigo_ibge, '3550308');
});

test('ordem de importação dos dias e limpeza', () => {
  const db = openDatabase(':memory:');
  const agora = new Date('2026-11-04T12:00:00Z');
  assert.equal(proximoDiaContratos(db, agora), '2026-11-03'); // ontem primeiro
  db.prepare("INSERT INTO contratos_dias VALUES ('2026-11-03', 10, '2026-11-04 11:00:00')").run();
  assert.equal(proximoDiaContratos(db, agora), '2026-11-04'); // depois hoje
  db.prepare("INSERT INTO contratos_dias VALUES ('2026-11-04', 10, '2026-11-04 11:30:00')").run();
  assert.equal(proximoDiaContratos(db, agora), '2026-11-02'); // depois os dias passados
  assert.equal(proximoDiaContratos(db, new Date('2026-11-04T18:00:00Z')), '2026-11-03', 'reimporta ontem após 6h');
  gravarContratos(db, [mapContrato({ ...contrato(9, 'velho', FA, P1, 1, null), dataPublicacaoPncp: '2025-01-01T00:00:00' })]);
  assert.equal(limparHistoricoAntigo(db, agora), 1);
});

test('importa contratos de um dia com paginação', async () => {
  const db = openDatabase(':memory:');
  const fake = async (url) => {
    const pg = Number(new URL(url).searchParams.get('pagina'));
    const data = Array.from({ length: pg === 1 ? 50 : 3 }, (_, i) => contrato(`${pg}-${i}`, 'Material de limpeza', FA, P1, 10, null));
    return Response.json({ data, paginasRestantes: pg === 1 ? 1 : 0 });
  };
  assert.equal(await importarContratosDoDia(db, '2026-11-03', { fetchImpl: fake, pausaMs: 0 }), 53);
  assert.equal(db.prepare("SELECT importados FROM contratos_dias WHERE dia = '2026-11-03'").get().importados, 53);
});

test('consulta de contratos com rankings e pesquisa de preços', async () => {
  const db = openDatabase(':memory:');
  const C1 = '33333333000133-1-000010/2026';
  const C2 = '44444444000144-1-000020/2026';
  gravarContratos(db, [
    contrato(1, 'Aquisição de medicamentos da farmácia básica', FA, P1, 5000, C1),
    contrato(2, 'Aquisição de medicamentos hospitalares', FA, P2, 3000, C2),
    contrato(3, 'Aquisição de medicamentos', FB, P2, 1000, C2),
    contrato(4, 'Água mineral para secretarias', FB, P1, 800, null, 'RJ'),
  ].map(mapContrato));

  const chamadas = [];
  const itens = {
    [C1]: [{ numeroItem: 1, descricao: 'Dipirona sódica 500mg comprimido', unidadeMedida: 'Comprimido', quantidade: 1000, valorUnitarioEstimado: 0.2, temResultado: true },
      { numeroItem: 2, descricao: 'Paracetamol 750mg', unidadeMedida: 'Comprimido', quantidade: 500, valorUnitarioEstimado: 0.3, temResultado: true }],
    [C2]: [{ numeroItem: 1, descricao: 'DIPIRONA SÓDICA 500 MG', unidadeMedida: 'Comprimido', quantidade: 2000, valorUnitarioEstimado: 0.25, temResultado: true },
      { numeroItem: 2, descricao: 'Dipirona injetável', unidadeMedida: 'Ampola', quantidade: 100, valorUnitarioEstimado: 1, temResultado: false }],
  };
  const fakePncp = async (url) => {
    const u = String(url);
    chamadas.push(u);
    const m = u.match(/orgaos\/(\d{14})\/compras\/(\d{4})\/(\d+)\/itens(?:\/(\d+)\/resultados)?/);
    const controle = m && `${m[1]}-1-0000${m[3]}/${m[2]}`;
    if (m && !m[4]) return Response.json(itens[controle] ?? []);
    if (m && m[4]) {
      const preco = controle === C1 ? 0.12 : 0.18;
      return Response.json([{ niFornecedor: FA[0], nomeRazaoSocialFornecedor: FA[1], valorUnitarioHomologado: preco, quantidadeHomologada: 10, valorTotalHomologado: preco * 10, dataResultado: '2026-10-20', sequencialResultado: 1, porteFornecedorNome: 'ME' }]);
    }
    return new Response(null, { status: 404 });
  };

  const app = await buildApp({ db, serveFrontend: false, ia: null, fetchImpl: fakePncp });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'h@e.com', senha: 'senha-segura-1' } });
  const cookie = cad.headers['set-cookie'].split(';')[0];
  const get = (url) => app.inject({ method: 'GET', url, headers: { cookie } });

  let r = (await get('/api/historico/contratos?q=medicamentos')).json();
  assert.equal(r.total, 3);
  assert.equal(r.valorTotal, 9000);
  assert.deepEqual(r.fornecedores.map((f) => [f.nome, f.contratos]), [['FARMA ALFA LTDA', 2], ['DISTRIBUIDORA BETA', 1]]);
  assert.equal(r.compradores[0].nome, 'MUNICIPIO DE DOIS');
  r = (await get('/api/historico/contratos?q=agua')).json(); // sem acento acha "Água"
  assert.equal(r.total, 1);
  r = (await get(`/api/historico/contratos?fornecedor=${FB[0]}`)).json();
  assert.equal(r.total, 2);

  // "dipirona" não aparece no objeto dos contratos: usa o assunto "medicamentos" para achar as compras.
  r = (await get('/api/historico/precos?q=dipirona%20500&assunto=medicamentos')).json();
  assert.equal(r.consultadas, 2);
  assert.deepEqual(r.grupos, [{ unidade: 'Comprimido', quantidade: 2, minimo: 0.12, mediana: 0.15, media: 0.15, maximo: 0.18 }]);
  assert.equal(r.itens[0].fornecedor, 'FARMA ALFA LTDA');
  assert.match(r.itens[0].link, /^https:\/\/pncp\.gov\.br\/app\/editais\//);
  assert.ok(!chamadas.some((u) => u.includes('/itens/2/resultados')), 'não busca resultado de item que não combina');

  // Segunda busca usa o que já foi guardado: nenhuma chamada nova ao PNCP.
  const antes = chamadas.length;
  r = (await get('/api/historico/precos?q=dipirona&assunto=medicamentos')).json();
  assert.equal(chamadas.length, antes);
  assert.equal(r.grupos[0].quantidade, 2);
  // Item já visto (paracetamol) tem o resultado buscado numa pesquisa posterior.
  r = await pesquisarPrecos(db, { q: 'paracetamol' }, { fetchImpl: fakePncp });
  assert.equal(r.grupos[0].quantidade, 1);

  assert.equal((await get('/api/historico/precos?q=ab')).statusCode, 400);
});

test('disco quase cheio: para de buscar dias antigos e libera espaço', async () => {
  const { _definirMedidorDisco, liberarEspaco } = await import('../src/services/historico.js');
  const db = openDatabase(':memory:');
  const agora = new Date('2026-11-04T12:00:00Z');
  db.prepare("INSERT INTO contratos_dias VALUES ('2026-11-03', 1, '2026-11-04 11:00:00'), ('2026-11-04', 1, '2026-11-04 11:30:00'), ('2026-10-01', 1, '2026-11-04 10:00:00')").run();
  gravarContratos(db, [mapContrato({ ...contrato(20, 'antigo', FA, P1, 1, null), dataPublicacaoPncp: '2026-10-01T10:00:00' })]);
  try {
    _definirMedidorDisco(() => ({ total: 1000, livre: 500, usoPct: 0.5 }));
    assert.equal(proximoDiaContratos(db, agora), '2026-11-02', 'com espaço, busca dias antigos');
    assert.equal(liberarEspaco(db), 0);
    _definirMedidorDisco(() => ({ total: 1000, livre: 300, usoPct: 0.7 }));
    assert.equal(proximoDiaContratos(db, agora), null, 'pouco espaço: não busca dias antigos');
    _definirMedidorDisco(() => ({ total: 1000, livre: 100, usoPct: 0.9 }));
    assert.equal(liberarEspaco(db), 1, 'muito pouco espaço: apaga o dia mais antigo');
    assert.equal(db.prepare("SELECT count(*) AS n FROM contratos_dias WHERE dia = '2026-10-01'").get().n, 0);
  } finally {
    _definirMedidorDisco(DISCO_FOLGADO);
  }
});

test('pesquisa de preços: PNCP fora do ar usa os Dados Abertos do Compras.gov.br', async () => {
  const db = openDatabase(':memory:');
  const compra = '33333333000133-1-000077/2026';
  gravarContratos(db, [mapContrato(contrato(70, 'Aquisição de ventiladores', FA, P1, 5000, compra))]);
  const fake = async (url) => {
    const u = new URL(String(url));
    if (u.hostname.includes('dadosabertos')) {
      assert.equal(u.searchParams.get('codigo'), compra);
      return Response.json({ resultado: [
        { numeroItemPncp: 1, descricaoResumida: 'Ventilador', descricaodetalhada: 'Ventilador de coluna 40 cm', unidadeMedida: 'Unidade', quantidade: 10, valorUnitarioEstimado: 300,
          temResultado: true, codFornecedor: FA[0], nomeFornecedor: FA[1], quantidadeResultado: 10, valorUnitarioResultado: 250, valorTotalResultado: 2500, dataResultado: '2026-10-01 00:00:00.0000000' },
        { numeroItemPncp: 2, descricaoResumida: 'Extensão elétrica', temResultado: true, codFornecedor: FB[0], valorUnitarioResultado: 30 }] });
    }
    return new Response('fora do ar', { status: 503 });
  };
  const r = await pesquisarPrecos(db, { q: 'ventilador' }, { fetchImpl: fake, prazoMs: 20000 });
  assert.equal(r.itens.length, 1);
  assert.deepEqual([r.itens[0].fornecedor, r.itens[0].valorUnitario, r.itens[0].data], [FA[1], 250, '2026-10-01']);
  assert.equal(r.grupos[0].unidade, 'Unidade');
  _pncpVoltou();
});

test('pesquisa de preços: PNCP fora do ar não trava a busca', async () => {
  const db = openDatabase(':memory:');
  gravarContratos(db, [1, 2, 3, 4, 5, 6].map((i) => mapContrato(contrato(80 + i, 'Aquisição de material de limpeza', FA, P1, 100, `33333333000133-1-00009${i}/2026`))));
  let pncp = 0;
  const fake = async (url) => {
    if (String(url).includes('dadosabertos')) return Response.json({ resultado: [] });
    pncp++;
    return new Response('fora', { status: 503 });
  };
  const t = Date.now();
  const r = await pesquisarPrecos(db, { q: 'detergente', assunto: 'limpeza' }, { fetchImpl: fake, prazoMs: 30000 });
  assert.ok(Date.now() - t < 10000, 'responde rápido');
  assert.ok(r.falhas > 0);
  assert.ok(pncp <= 6, `não insiste no PNCP fora do ar (${pncp} chamadas)`);
  _pncpVoltou();
});
