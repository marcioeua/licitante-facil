import { test } from 'node:test';
import assert from 'node:assert/strict';

const { openDatabase } = await import('../src/db/index.js');
const { importarItensDoDia, proximoDiaItens, buscarItens, importarItensDasOportunidades, completarCabecalhos } = await import('../src/services/itens.js');
const { _definirMedidorDisco } = await import('../src/services/historico.js');
_definirMedidorDisco(() => ({ total: 1e6, livre: 1e6, usoPct: 0 }));

const C1 = '00394502000144-1-001752/2026';
const C2 = '12200150000128-1-000083/2026';
const item = (compra, n, desc, extra = {}) => ({ numeroControlePNCPCompra: compra, numeroItemPncp: n, descricaoResumida: desc.split(' ')[0], descricaodetalhada: desc,
  materialOuServico: 'M', unidadeMedida: 'Unidade', quantidade: 10, valorUnitarioEstimado: 100, situacaoCompraItemNome: 'Em andamento', temResultado: false,
  dataInclusaoPncp: '2026-10-20T10:00:00', orgaoEntidadeCnpj: compra.slice(0, 14), ...extra });

test('busca por item: importa o dia (data final + 1), pagina e pesquisa com filtros e cabeçalho', async () => {
  const db = openDatabase(':memory:');
  const urls = [];
  const fake = async (url) => {
    const u = new URL(String(url));
    urls.push(u);
    if (u.pathname.includes('2_consultarItens')) {
      assert.equal(u.searchParams.get('dataInclusaoPncpInicial'), '2026-10-20');
      assert.equal(u.searchParams.get('dataInclusaoPncpFinal'), '2026-10-21');
      if (u.searchParams.get('pagina') === '1') return Response.json({ resultado: [item(C1, 1, 'Ventilador de parede 60 cm oscilante'), item(C1, 2, 'Extensão elétrica')], paginasRestantes: 1 });
      return Response.json({ resultado: [item(C2, 1, 'Ventiladores de teto', { situacaoCompraItemNome: 'Homologado', temResultado: true, codFornecedor: '39.872.041/0001-03', nomeFornecedor: 'ECO CLEAN', valorUnitarioResultado: 89.5, dataResultado: '2026-10-25 00:00:00.0000000' })], paginasRestantes: 0 });
    }
    if (u.pathname.includes('1.1_consultarContratacoes')) {
      const c = u.searchParams.get('codigo');
      return Response.json({ resultado: [{ orgaoEntidadeRazaoSocial: c === C1 ? 'COMANDO DA MARINHA' : 'PREFEITURA DE X', unidadeOrgaoNomeUnidade: 'UASG', unidadeOrgaoUfSigla: c === C1 ? 'RJ' : 'MG',
        unidadeOrgaoMunicipioNome: 'Cidade', modalidadeNome: 'Dispensa', numeroCompra: '25', anoCompraPncp: '2026', dataAberturaPropostaPncp: '2026-10-21T08:00:00', dataEncerramentoPropostaPncp: '2099-01-01T08:00:00', srp: 'False' }] });
    }
    return new Response(null, { status: 404 });
  };
  assert.equal(await importarItensDoDia(db, '2026-10-20', { fetchImpl: fake, pausaMs: 0 }), 3);
  let r = await buscarItens(db, { q: 'ventilador' }, { fetchImpl: fake });
  assert.equal(r.total, 2);
  const marinha = r.itens.find((i) => i.compra === C1);
  assert.deepEqual([marinha.orgao, marinha.uf, marinha.modalidade, marinha.item, marinha.portal], ['COMANDO DA MARINHA', 'RJ', 'Dispensa', 1, 'Compras.gov.br']);
  const hom = r.itens.find((i) => i.compra === C2);
  assert.deepEqual([hom.situacao, hom.fornecedorNi, hom.fornecedorNome, hom.valorResultado, hom.dataResultado], ['Homologado', '39872041000103', 'ECO CLEAN', 89.5, '2026-10-25']);
  assert.match(hom.linkPncp, /editais\/12200150000128\/2026\/83$/);
  const chamadas = urls.length;
  r = await buscarItens(db, { q: 'ventilador', uf: 'RJ' }, { fetchImpl: fake });
  assert.deepEqual(r.itens.map((i) => i.compra), [C1]);
  assert.equal(urls.length, chamadas, 'cabeçalho já guardado');
  r = await buscarItens(db, { q: 'ventilador', situacao: 'homologados' }, { fetchImpl: fake });
  assert.deepEqual(r.itens.map((i) => i.compra), [C2]);
  r = await buscarItens(db, { q: 'ventilador', situacao: 'abertas' }, { fetchImpl: fake });
  assert.deepEqual(r.itens.map((i) => i.compra), [C1]);
  assert.equal((await buscarItens(db, { q: 'geladeira' }, { fetchImpl: fake })).total, 0);
});

test('busca por item: ordem dos dias e itens das licitações abertas pelo PNCP', async () => {
  const db = openDatabase(':memory:');
  const agora = new Date('2026-11-09T12:00:00Z');
  assert.equal(proximoDiaItens(db, agora), '2026-11-08');
  db.prepare("INSERT INTO itens_dias VALUES ('2026-11-08', 1, '2026-11-09 11:00:00'), ('2026-11-09', 1, '2026-11-09 11:00:00'), ('2026-11-01', 1, '2026-11-01 11:00:00')").run();
  assert.equal(proximoDiaItens(db, agora), '2026-11-01', 'reimporta dia recente antigo (situação muda)');
  db.prepare("UPDATE itens_dias SET importado_em = '2026-11-09 10:00:00' WHERE dia = '2026-11-01'").run();
  assert.equal(proximoDiaItens(db, agora), '2026-11-07');

  db.prepare(`INSERT INTO oportunidades (numero_controle_pncp, objeto, orgao_nome, uf, modalidade, numero_compra, ano_compra, data_publicacao, data_abertura, data_encerramento, link_origem)
    VALUES ('83102277000152-1-000054/2026', 'Aquisição de ventiladores', 'PREFEITURA MUNICIPAL DE ITAQUI', 'RS', 'Dispensa', '054', 2026, '2026-11-03T10:00:00', '2026-11-04T08:00:00', '2099-01-01T00:00:00', 'https://www.portaldecompraspublicas.com.br/processos/rs/x')`).run();
  const fake = async (url) => {
    assert.match(String(url), /\/api\/pncp\/v1\/orgaos\/83102277000152\/compras\/2026\/54\/itens/);
    return Response.json([{ numeroItem: 1, descricao: 'Ventilador de parede industrial oscilante', materialOuServico: 'M', unidadeMedida: 'UN', quantidade: 15, valorUnitarioEstimado: 450, situacaoCompraItemNome: 'Em andamento' }]);
  };
  const r = await importarItensDasOportunidades(db, { fetchImpl: fake });
  assert.deepEqual([r.feitas, r.falhas], [1, 0]);
  assert.equal((await importarItensDasOportunidades(db, { fetchImpl: fake })).fila, 0, 'não busca de novo');
  const b = await buscarItens(db, { q: 'ventilador', situacao: 'abertas', uf: 'RS' }, { fetchImpl: fake });
  assert.equal(b.total, 1);
  assert.deepEqual([b.itens[0].orgao, b.itens[0].quantidade, b.itens[0].unidade, b.itens[0].portal, b.itens[0].publicacao], ['PREFEITURA MUNICIPAL DE ITAQUI', 15, 'UN', 'Portal de Compras Públicas', '2026-11-03T10:00:00']);
  assert.ok(b.itens[0].oportunidadeId);
  assert.equal(await completarCabecalhos(db, { fetchImpl: fake }), 0);
});
