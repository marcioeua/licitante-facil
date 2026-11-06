import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { mapContrato, gravarContratos } = await import('../src/services/historico.js');

const ct = (i, objeto, forn, orgao, uf, esfera, valor, ibge = null) => mapContrato({
  numeroControlePNCP: `E-${i}`, objetoContrato: objeto, valorGlobal: valor, niFornecedor: forn[0], nomeRazaoSocialFornecedor: forn[1],
  orgaoEntidade: { cnpj: orgao, razaoSocial: `ORGAO ${orgao}`, esferaId: esfera }, unidadeOrgao: { ufSigla: uf, municipioNome: 'Cidade', codigoIbge: ibge },
  categoriaProcesso: { nome: 'Compras' }, dataAssinatura: '2026-11-02', dataPublicacaoPncp: '2026-11-03T10:00:00',
});
const A = ['11222333000181', 'LIMPA TUDO LTDA'];
const B = ['22222222000122', 'BETA DISTRIBUIDORA'];
const C = ['33333333000133', 'GAMA COMERCIO'];

test('análise de empresas: sugestões, perfil, Pagômetro dos clientes, concorrentes, cadastro e comparação', async () => {
  const db = openDatabase(':memory:');
  gravarContratos(db, [
    ct(1, 'Aquisição de material de limpeza e higiene', A, '1', 'SP', 'M', 1000, '3550308'),
    ct(2, 'Fornecimento de material de limpeza', A, '2', 'CE', 'E', 3000),
    ct(3, 'Produtos de limpeza', B, '1', 'SP', 'M', 500, '3550308'),
    ct(4, 'Papel higiênico e limpeza', B, '2', 'CE', 'E', 700),
    ct(5, 'Notebooks', C, '9', 'RJ', 'F', 9000),
  ]);
  db.prepare("INSERT INTO capag_entes (tipo, codigo, nome, nome_norm, uf, capag, nota3, atualizado_em) VALUES ('municipio', '3550308', 'São Paulo', 'sao paulo', 'SP', 'C', 'C', 'x'), ('estado', 'CE', 'Ceará', 'ceara', 'CE', 'A', 'A', 'x')").run();

  let chamadasCnpj = 0;
  const fetchCnpj = async (url) => {
    chamadasCnpj++;
    assert.match(String(url), /11222333000181$/);
    return Response.json({ razao_social: 'LIMPA TUDO LTDA', nome_fantasia: 'Limpa Tudo', porte: 'MICRO EMPRESA', cnae_fiscal: 4649408,
      cnae_fiscal_descricao: 'Comércio atacadista de produtos de higiene e limpeza', descricao_situacao_cadastral: 'ATIVA',
      data_inicio_atividade: '2015-03-01', municipio: 'CAMPINAS', uf: 'SP', capital_social: 50000, opcao_pelo_simples: true,
      qsa: [{ nome_socio: 'FULANO', qualificacao_socio: 'Sócio-Administrador' }] });
  };
  const app = await buildApp({ db, serveFrontend: false, ia: null, fetchCnpj });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'e@e.com', senha: 'senha-segura-1' } });
  const cookie = cad.headers['set-cookie'].split(';')[0];
  const get = async (url) => (await app.inject({ method: 'GET', url, headers: { cookie } })).json();

  assert.deepEqual((await get('/api/analise-empresas/sugestoes?q=limpa')).map((s) => s.ni), [A[0]]);
  assert.deepEqual((await get('/api/analise-empresas/sugestoes?q=2222')).map((s) => s.ni), [B[0]]);

  const p = await get(`/api/analise-empresas/${A[0]}`);
  assert.equal(p.nome, 'LIMPA TUDO LTDA');
  assert.deepEqual([p.resumo.contratos, p.resumo.valor, p.resumo.clientes, p.resumo.estados], [2, 4000, 2, 2]);
  assert.equal(p.cadastro.porte, 'MICRO EMPRESA');
  assert.equal(p.cadastro.atividade, 'Comércio atacadista de produtos de higiene e limpeza');
  assert.ok(p.assuntos.some((a) => a.termo === 'limpeza' && a.contratos === 2));
  assert.deepEqual(p.clientes.map((c) => [c.cnpj, c.pagometro]), [['2', 'baixo'], ['1', 'alto']]);
  assert.deepEqual(p.riscoClientes, { baixo: 3000, alto: 1000 });
  assert.deepEqual(p.concorrentes.map((c) => [c.nome, c.clientesEmComum]), [['BETA DISTRIBUIDORA', 2]]);

  await get(`/api/analise-empresas/${A[0]}`);
  assert.equal(chamadasCnpj, 1, 'cadastro guardado: não consulta de novo');

  const comp = await get(`/api/analise-empresas/comparar?cnpjs=${A[0]},${B[0]}`);
  assert.deepEqual(comp.map((c) => [c.nome, c.valor]), [['LIMPA TUDO LTDA', 4000], ['BETA DISTRIBUIDORA', 1200]]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/analise-empresas/123', headers: { cookie } })).statusCode, 400);

  // Sem acesso à BrasilAPI o perfil continua funcionando.
  const app2 = await buildApp({ db, serveFrontend: false, ia: null, fetchCnpj: async () => { throw new Error('offline'); } });
  const p2 = (await app2.inject({ method: 'GET', url: `/api/analise-empresas/${B[0]}`, headers: { cookie } })).json();
  assert.equal(p2.cadastro, null);
  assert.equal(p2.resumo.contratos, 2);
});

test('cadastro do CNPJ: usa a fonte reserva quando a primeira falha', async () => {
  const { cadastroCnpj } = await import('../src/services/empresas.js');
  const db = openDatabase(':memory:');
  const urls = [];
  const fake = async (url, opts) => {
    urls.push(String(url));
    assert.match(opts.headers['user-agent'], /BuscaPregaoIA/);
    if (String(url).includes('brasilapi')) return new Response('bloqueado', { status: 403 });
    return Response.json({ razao_social: 'EMPRESA RESERVA LTDA', porte: 'DEMAIS' });
  };
  const d = await cadastroCnpj(db, '11.222.333/0001-81', { fetchImpl: fake, log: () => {} });
  assert.equal(d.razaoSocial, 'EMPRESA RESERVA LTDA');
  assert.deepEqual(urls.map((u) => new URL(u).hostname), ['brasilapi.com.br', 'minhareceita.org']);
  const nada = await cadastroCnpj(openDatabase(':memory:'), '11222333000181', { fetchImpl: async () => new Response(null, { status: 404 }), log: () => {} });
  assert.equal(nada, null);
});

test('vitórias: janelas de 365 dias, paginação, cancelados fora, cache e descrições do PNCP', async () => {
  const { janelas, vitoriasDoFornecedor } = await import('../src/services/vitorias.js');
  const js = janelas(2, new Date('2026-11-05T12:00:00Z'));
  assert.deepEqual(js.map((j) => [j.ini, j.fim]), [['2025-11-06', '2026-11-05'], ['2024-11-06', '2025-11-05']]);

  const db = openDatabase(':memory:');
  const atual = janelas(2)[0].ini; // janela do último ano, a partir de hoje
  const chamadas = { dados: 0, pncp: 0 };
  const res = (compra, item, valor, data, extra = {}) => ({ numeroControlePNCPCompra: compra, numeroItemPncp: item, orgaoEntidadeCnpj: '05853163000130',
    unidadeOrgaoUfSigla: 'PA', quantidadeHomologada: 1, valorUnitarioHomologado: valor, valorTotalHomologado: valor, dataResultadoPncp: `${data}T00:00:00`,
    porteFornecedorNome: 'ME', aplicacaoBeneficioMeepp: item === 1, ...extra });
  const fake = async (url) => {
    const u = new URL(String(url));
    if (u.hostname.includes('dadosabertos')) {
      chamadas.dados++;
      const ini = u.searchParams.get('dataResultadoPncpInicial');
      const pg = Number(u.searchParams.get('pagina'));
      if (ini === atual && pg === 1) return Response.json({ resultado: [res('05853163000130-1-000155/2026', 1, 115000, '2026-08-14')], paginasRestantes: 1 });
      if (ini === atual && pg === 2) return Response.json({ resultado: [res('05853163000130-1-000155/2026', 2, 98500, '2026-08-14'), res('05853163000130-1-000155/2026', 3, 1, '2026-08-14', { dataCancelamentoPncp: '2026-09-01' })], paginasRestantes: 0 });
      return Response.json({ resultado: [res('05853163000130-1-000099/2025', 1, 54078, '2025-03-20')], paginasRestantes: 0 });
    }
    chamadas.pncp++;
    if (u.pathname.endsWith('/compras/2026/155')) return Response.json({ orgaoEntidade: { razaoSocial: 'MUNICIPIO DE MARABA' }, unidadeOrgao: { ufSigla: 'PA', municipioNome: 'Marabá', nomeUnidade: 'Secretaria de Obras' }, modalidadeNome: 'Pregão - Eletrônico', numeroCompra: '90074', anoCompra: 2026, dataAberturaProposta: '2026-06-10T09:00:00', linkSistemaOrigem: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/x' });
    if (u.pathname.includes('/2026/155/itens')) return Response.json([{ numeroItem: 1, descricao: 'Caneta Esferográfica Material: Acrílico, Cor: Vermelha', unidadeMedida: 'Unidade', quantidade: 5000, valorUnitarioEstimado: 230000, situacaoCompraItemNome: 'Homologado', temResultado: true }, { numeroItem: 2, descricao: 'Pneu agrícola', unidadeMedida: 'Unidade', temResultado: true }]);
    return new Response(null, { status: 500 });
  };
  const v = await vitoriasDoFornecedor(db, '31650693000191', { anos: 2, fetchImpl: fake });
  assert.deepEqual({ ...v.resumo, descontoMedio: Math.round(v.resumo.descontoMedio * 1000) / 1000 }, { itens: 3, compras: 2, valor: 267578, orgaos: 1, beneficioMeEpp: 2, descontoMedio: 0.5 });
  assert.deepEqual(v.porAno.map((a) => [a.chave, a.valor]), [['2025', 54078], ['2026', 213500]]);
  const card = v.itens.find((i) => i.valorUnitario === 115000);
  assert.equal(card.titulo, 'Caneta Esferográfica');
  assert.equal(card.situacaoItem, 'Homologado');
  assert.equal(card.desconto, 0.5);
  assert.deepEqual([card.orgao, card.modalidade, card.numeroCompra, card.anoCompra, card.portal, card.municipio], ['MUNICIPIO DE MARABA', 'Pregão - Eletrônico', '90074', 2026, 'Compras.gov.br', 'Marabá']);
  assert.match(card.linkPncp, /editais\/05853163000130\/2026\/155$/);
  assert.equal(v.itens.find((i) => i.valorUnitario === 54078).descricao, null, 'PNCP falhou: segue sem descrição');

  const antes = { ...chamadas };
  await vitoriasDoFornecedor(db, '31650693000191', { anos: 2, fetchImpl: fake });
  assert.equal(chamadas.dados, antes.dados, 'janelas em cache');
  assert.equal(chamadas.pncp, antes.pncp, 'não insiste no PNCP que acabou de falhar');
});
