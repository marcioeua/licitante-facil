import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'lf-test-'));
process.env.UPLOAD_DIR = join(tmp, 'uploads');

const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { sincronizarPropostasAbertas, mapContratacao } = await import('../src/services/pncp.js');
const { cnpjValido } = await import('../src/routes/empresas.js');
const { enviarAlertas } = await import('../src/services/alertas.js');

// Fixture no formato de /v1/contratacoes/proposta do PNCP (dados fictícios de teste).
const futuro = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 19);
const contratacao = (seq, objeto, uf, valor, modalidadeId = 6) => ({
  numeroControlePNCP: `00000000000191-1-0000${seq}/2026`,
  objetoCompra: objeto,
  modalidadeId,
  modalidadeNome: 'Pregão - Eletrônico',
  modoDisputaNome: 'Aberto',
  situacaoCompraNome: 'Divulgada no PNCP',
  orgaoEntidade: { cnpj: '00000000000191', razaoSocial: 'PREFEITURA MUNICIPAL DE TESTE' },
  unidadeOrgao: { ufSigla: uf, municipioNome: 'Cidade Teste', nomeUnidade: 'Secretaria de Saúde' },
  numeroCompra: String(seq),
  anoCompra: 2026,
  sequencialCompra: seq,
  valorTotalEstimado: valor,
  srp: true,
  dataPublicacaoPncp: futuro(-1),
  dataAberturaProposta: futuro(1),
  dataEncerramentoProposta: futuro(10),
  linkSistemaOrigem: 'https://exemplo.gov.br/compra',
});
const FIXTURE = [
  contratacao(1, 'Aquisição de material de escritório e papelaria', 'SP', 50000),
  contratacao(2, 'Contratação de serviços de limpeza predial', 'MG', 300000),
  contratacao(3, 'Aquisição de medicamentos para farmácia básica', 'SP', 1200000),
];

let db, app, cookie;

before(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db, serveFrontend: false });
  const fakeFetch = async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('codigoModalidadeContratacao') !== '6') return new Response(null, { status: 204 });
    return Response.json({ data: FIXTURE, totalRegistros: 3, totalPaginas: 1, numeroPagina: 1, paginasRestantes: 0 });
  };
  const r = await sincronizarPropostasAbertas(db, { fetchImpl: fakeFetch, log: () => {}, pausaMs: 0 });
  assert.equal(r.importadas, 3);
});

after(() => rmSync(tmp, { recursive: true, force: true }));

const req = (method, url, payload) =>
  app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });

test('mapContratacao gera link do PNCP', () => {
  const m = mapContratacao(FIXTURE[0]);
  assert.equal(m.link_pncp, 'https://pncp.gov.br/app/editais/00000000000191/2026/1');
  assert.equal(m.uf, 'SP');
  assert.equal(m.registro_preco, 1);
});

test('validação de CNPJ', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('11111111111111'), false);
});

test('API exige login', async () => {
  const r = await req('GET', '/api/oportunidades');
  assert.equal(r.statusCode, 401);
});

test('cadastro, login e /me', async () => {
  let r = await req('POST', '/api/auth/cadastro', { nome: 'Teste', email: 'teste@exemplo.com', senha: 'senha-forte-1' });
  assert.equal(r.statusCode, 200);
  r = await req('POST', '/api/auth/login', { email: 'teste@exemplo.com', senha: 'errada123' });
  assert.equal(r.statusCode, 401);
  r = await req('POST', '/api/auth/login', { email: 'TESTE@exemplo.com', senha: 'senha-forte-1' });
  assert.equal(r.statusCode, 200);
  cookie = r.headers['set-cookie'].split(';')[0];
  r = await req('GET', '/api/auth/me');
  assert.equal(r.json().email, 'teste@exemplo.com');
});

test('busca com texto sem acento, UF e valor', async () => {
  let r = await req('GET', '/api/oportunidades?q=medicamento');
  assert.equal(r.json().total, 1);
  r = await req('GET', '/api/oportunidades?q=escritorio');
  assert.equal(r.json().itens[0].objeto, FIXTURE[0].objetoCompra);
  r = await req('GET', '/api/oportunidades?uf=SP&valorMin=100000');
  assert.deepEqual(r.json().itens.map((i) => i.numero_compra), ['3']);
  r = await req('GET', '/api/oportunidades?q=%22%27%29(');
  assert.equal(r.statusCode, 200);
});

test('funil: criar negócio, checklist, mover e documentos', async () => {
  const op = (await req('GET', '/api/oportunidades?q=limpeza')).json().itens[0];
  let r = await req('POST', '/api/negocios', { oportunidade_id: op.id });
  assert.equal(r.statusCode, 201);
  const neg = r.json();
  assert.equal(neg.etapa, 'triagem');
  assert.ok(neg.checklist.length >= 5);
  r = await req('POST', '/api/negocios', { oportunidade_id: op.id });
  assert.equal(r.statusCode, 409);

  r = await req('PATCH', `/api/negocios/${neg.id}/checklist/${neg.checklist[0].id}`, { feito: true });
  assert.equal(r.json().feito, 1);
  r = await req('POST', '/api/negocios/reordenar', [{ id: neg.id, etapa: 'proposta', posicao: 0 }]);
  assert.equal(r.statusCode, 200);
  r = await req('GET', '/api/negocios');
  assert.equal(r.json()[0].etapa, 'proposta');
  assert.equal(r.json()[0].checklist_feitos, 1);

  r = await req('PATCH', `/api/negocios/${neg.id}`, { etapa: 'invalida' });
  assert.equal(r.statusCode, 400);

  const busca = (await req('GET', '/api/oportunidades?q=limpeza')).json().itens[0];
  assert.equal(busca.negocio_etapa, 'proposta');
});

test('empresas e documentos com upload', async () => {
  let r = await req('POST', '/api/empresas', { razao_social: 'Minha Empresa LTDA', cnpj: '11.222.333/0001-81' });
  assert.equal(r.statusCode, 201);
  const empresa = r.json();
  r = await req('POST', '/api/empresas', { razao_social: 'X', cnpj: '123' });
  assert.equal(r.statusCode, 400);

  const boundary = '----lf';
  const venc = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="nome"\r\n\r\nCND Federal`,
    `--${boundary}\r\nContent-Disposition: form-data; name="categoria"\r\n\r\ncertidao_federal`,
    `--${boundary}\r\nContent-Disposition: form-data; name="validade"\r\n\r\n${venc}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="empresa_id"\r\n\r\n${empresa.id}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="cnd.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 teste`,
    `--${boundary}--\r\n`,
  ].join('\r\n');
  r = await app.inject({
    method: 'POST', url: '/api/documentos', payload: body,
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(r.statusCode, 201, r.body);
  const doc = r.json();
  assert.equal(doc.status, 'vencendo');
  assert.equal(doc.arquivo_path, undefined);

  r = await req('GET', `/api/documentos/${doc.id}/arquivo`);
  assert.equal(r.body, '%PDF-1.4 teste');

  r = await req('GET', '/api/dashboard');
  assert.equal(r.json().documentosAtencao.length, 1);
  r = await req('GET', '/api/agenda');
  assert.ok(r.json().some((e) => e.tipo === 'vencimento'));
});

test('alertas: resultados, dashboard e e-mail', async () => {
  let r = await req('POST', '/api/alertas', { nome: 'Saúde', palavras: 'medicamentos, farmácia', ufs: ['SP'] });
  assert.equal(r.statusCode, 201);
  r = await req('GET', `/api/alertas/${r.json().id}/resultados`);
  assert.equal(r.json().total, 1);
  r = await req('GET', '/api/dashboard');
  assert.equal(r.json().recomendadas.length, 1);

  const enviados = [];
  const transport = { sendMail: async (m) => enviados.push(m) };
  db.prepare("UPDATE alertas SET ultimo_envio = '2000-01-01 00:00:00'").run();
  let res = await enviarAlertas(db, { transport });
  assert.equal(res.enviados, 1);
  assert.match(enviados[0].html, /medicamentos/);
  res = await enviarAlertas(db, { transport });
  assert.equal(res.enviados, 0, 'não reenvia as mesmas oportunidades');
});

test('isolamento entre usuários', async () => {
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Outro', email: 'outro@exemplo.com', senha: 'outra-senha-1' } });
  const outro = r1.headers['set-cookie'].split(';')[0];
  const r = await app.inject({ method: 'GET', url: '/api/negocios', headers: { cookie: outro } });
  assert.deepEqual(r.json(), []);
  const docs = await app.inject({ method: 'GET', url: '/api/documentos/1/arquivo', headers: { cookie: outro } });
  assert.equal(docs.statusCode, 404);
});

test('cadastro em produção: só a primeira conta, depois com convite', async () => {
  const antigo = { ...process.env };
  try {
    const db2 = openDatabase(':memory:');
    const app2 = await buildApp({ db: db2, serveFrontend: false, ia: null });
    const cad = (email, convite) => app2.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Fulano', email, senha: 'senha-segura-1', convite } });
    process.env.NODE_ENV = 'production';
    delete process.env.CODIGO_CONVITE;
    delete process.env.CADASTRO_ABERTO;
    assert.equal((await cad('dono@e.com')).statusCode, 200);
    assert.equal((await cad('outro@e.com')).statusCode, 403);
    process.env.CODIGO_CONVITE = 'equipe2026';
    assert.equal((await cad('outro@e.com', 'errado')).statusCode, 403);
    assert.equal((await cad('outro@e.com', 'equipe2026')).statusCode, 200);
  } finally {
    process.env.NODE_ENV = antigo.NODE_ENV ?? '';
    if (antigo.NODE_ENV === undefined) delete process.env.NODE_ENV;
    delete process.env.CODIGO_CONVITE;
  }
});

test('alterar senha: exige a senha atual e passa a valer a nova', async () => {
  const { openDatabase } = await import('../src/db/index.js');
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({ db: openDatabase(':memory:'), serveFrontend: false, ia: null });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Dono', email: 's@e.com', senha: 'senha-antiga-1' } });
  const cookie = cad.headers['set-cookie'].split(';')[0];
  const trocar = (atual, nova, c = cookie) => app.inject({ method: 'PUT', url: '/api/auth/senha', headers: c ? { cookie: c } : {}, payload: { atual, nova } });
  assert.equal((await trocar('senha-antiga-1', 'nova-senha-123', null)).statusCode, 401);
  assert.equal((await trocar('errada-errada', 'nova-senha-123')).statusCode, 400);
  assert.equal((await trocar('senha-antiga-1', 'curta')).statusCode, 400);
  assert.equal((await trocar('senha-antiga-1', 'nova-senha-123')).statusCode, 200);
  const login = (senha) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 's@e.com', senha } });
  assert.equal((await login('senha-antiga-1')).statusCode, 401);
  assert.equal((await login('nova-senha-123')).statusCode, 200);
});
