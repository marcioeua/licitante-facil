import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { normalizarNumero, limparParametro, clienteWhatsApp, enviarNotificacoesPorWhatsApp, processarFilaWhatsApp } = await import('../src/services/whatsapp.js');
const { notificar, querWhatsApp, salvarConfig } = await import('../src/services/agentes.js');

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\n%%EOF');

test('número e parâmetros do modelo', () => {
  assert.equal(normalizarNumero('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizarNumero('011 3333-4444'), '551133334444');
  assert.equal(normalizarNumero('+55 21 99999-8888'), '5521999998888');
  assert.equal(normalizarNumero('+1 415 555 0100'), '14155550100');
  assert.equal(normalizarNumero('12345'), null);
  assert.equal(limparParametro('Linha 1\nLinha 2\t\tfim     x'), 'Linha 1 · Linha 2 · fim x');
  assert.equal(limparParametro(''), '-');
  assert.equal(limparParametro('a'.repeat(50), 10).length, 10);
});

test('cliente da API oficial: modelo de aviso e documento com upload da mídia', async () => {
  const chamadas = [];
  const fake = async (url, init) => {
    chamadas.push({ url: String(url), init });
    if (String(url).endsWith('/media')) return Response.json({ id: 'midia-1' });
    return Response.json({ messages: [{ id: 'wamid.1' }] });
  };
  process.env.WHATSAPP_TOKEN = 'tk'; process.env.WHATSAPP_PHONE_ID = '123';
  try {
    const c = clienteWhatsApp({ fetchImpl: fake });
    await c.enviarAviso('5511987654321', 'Título', 'Linha 1\nLinha 2');
    let corpo = JSON.parse(chamadas[0].init.body);
    assert.match(chamadas[0].url, /graph\.facebook\.com\/v\d+\.\d+\/123\/messages$/);
    assert.equal(chamadas[0].init.headers.authorization, 'Bearer tk');
    assert.deepEqual([corpo.to, corpo.template.name, corpo.template.language.code], ['5511987654321', 'aviso_busca_pregao', 'pt_BR']);
    assert.deepEqual(corpo.template.components[0].parameters.map((p) => p.text), ['Título', 'Linha 1 · Linha 2']);

    await c.enviarDocumento('5511987654321', { bytes: pdf, nomeArquivo: 'Edital.pdf', titulo: 'Material de limpeza', texto: 'Prefeitura' });
    assert.match(chamadas[1].url, /\/123\/media$/);
    assert.ok(chamadas[1].init.body instanceof FormData);
    corpo = JSON.parse(chamadas[2].init.body);
    assert.equal(corpo.template.name, 'edital_busca_pregao');
    assert.deepEqual(corpo.template.components[0], { type: 'header', parameters: [{ type: 'document', document: { id: 'midia-1', filename: 'Edital.pdf' } }] });

    const erro = clienteWhatsApp({ fetchImpl: async () => Response.json({ error: { message: 'Template não existe', code: 132001 } }, { status: 400 }) });
    await assert.rejects(erro.enviarAviso('55', 'a', 'b'), (e) => e.status === 400 && e.codigo === 132001);
  } finally {
    delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_ID;
  }
  assert.equal(clienteWhatsApp(), null, 'sem token: desligado');
});

test('WhatsApp no sistema: ativação, teste, edital em PDF, avisos dos agentes e fila', async () => {
  const db = openDatabase(':memory:');
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '11222333000181-1-000045/2026', objetoCompra: 'Aquisição de material de limpeza', modalidadeId: 6,
    modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, numeroCompra: '90045', sequencialCompra: 45, srp: false, dataPublicacaoPncp: '2026-11-01T10:00:00',
    dataEncerramentoProposta: '2026-11-18T09:00:00', valorTotalEstimado: 48000, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA DE TESTE' },
    unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } })]);
  const opId = db.prepare('SELECT id FROM oportunidades').get().id;
  const enviados = [];
  const whatsapp = {
    enviarAviso: async (para, titulo, texto) => { enviados.push({ tipo: 'aviso', para, titulo, texto }); },
    enviarDocumento: async (para, d) => { enviados.push({ tipo: 'doc', para, ...d }); },
  };
  const fakePncp = async (url) => {
    const u = String(url);
    if (u.endsWith('/arquivos')) return Response.json([{ url: 'https://pncp.test/arq/1', tipoDocumentoId: 2, tipoDocumentoNome: 'Edital', sequencialDocumento: 1, statusAtivo: true }]);
    if (u.endsWith('/arq/1')) return new Response(pdf, { headers: { 'content-disposition': 'attachment; filename="Edital 90045.pdf"' } });
    return new Response(null, { status: 404 });
  };
  const app = await buildApp({ db, serveFrontend: false, ia: null, whatsapp, fetchImpl: fakePncp });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'w@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  const uid = db.prepare('SELECT id FROM usuarios').get().id;

  notificar(db, { usuarioId: uid, agente: 'vigia', tipo: 'mudanca', titulo: 'Aviso antigo' }); // antes de ativar: não vai
  assert.equal((await req('GET', '/api/whatsapp')).json().servidor, true);
  assert.equal((await req('PUT', '/api/whatsapp', { numero: '123', ativo: true, consentimento: true })).statusCode, 400);
  assert.equal((await req('PUT', '/api/whatsapp', { numero: '(11) 98765-4321', ativo: true })).statusCode, 400, 'exige autorização');
  assert.equal((await req('POST', '/api/whatsapp/edital/' + opId)).statusCode, 400, 'sem ativar');
  let r = await req('PUT', '/api/whatsapp', { numero: '(11) 98765-4321', ativo: true, consentimento: true });
  assert.deepEqual([r.json().numero, r.json().ativo], ['5511987654321', true]);
  db.prepare("UPDATE usuarios SET whatsapp_desde = datetime('now', '-1 minute')").run();

  assert.equal((await req('POST', '/api/whatsapp/teste')).statusCode, 200);
  assert.equal(enviados.at(-1).titulo, 'Teste do Busca Pregão IA');

  r = await req('POST', `/api/whatsapp/edital/${opId}`);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { documento: true, arquivo: 'Edital 90045.pdf' });
  const doc = enviados.at(-1);
  assert.equal(doc.tipo, 'doc');
  assert.equal(doc.titulo, 'Aquisição de material de limpeza');
  assert.match(doc.texto, /PREFEITURA DE TESTE - Campinas\/SP · Pregão - Eletrônico nº 90045\/2026 · Valor estimado: R\$\s?48\.000,00/);
  assert.match(doc.texto, /\/#\/oportunidades\/\d+$/);

  // Avisos: vigia sim; leitor desligado por padrão; chat do pregoeiro sempre.
  enviados.length = 0;
  notificar(db, { usuarioId: uid, agente: 'vigia', tipo: 'mudanca', titulo: 'Prazo mudou', mensagem: 'De 18/11\npara 20/11', link: '/negocios/1' });
  notificar(db, { usuarioId: uid, agente: 'leitor', tipo: 'edital_lido', titulo: 'Edital lido' });
  notificar(db, { usuarioId: uid, agente: 'pregoeiro', tipo: 'prazo_pregoeiro', titulo: 'Pregoeiro: 1 prazo' });
  db.prepare("UPDATE notificacoes SET criado_em = datetime('now') WHERE titulo != 'Aviso antigo'").run();
  db.prepare("UPDATE notificacoes SET criado_em = datetime('now', '-10 minutes') WHERE titulo = 'Aviso antigo'").run();
  const n = await enviarNotificacoesPorWhatsApp(db, { cliente: whatsapp, querWhatsApp: querWhatsApp(db), appUrl: 'https://app.exemplo.com.br' });
  assert.equal(n, 2);
  assert.deepEqual(enviados.map((e) => e.titulo), ['Prazo mudou', 'Pregoeiro: 1 prazo']);
  assert.match(enviados[0].texto, /Abrir: https:\/\/app\.exemplo\.com\.br\/#\/negocios\/1/);
  assert.equal(await enviarNotificacoesPorWhatsApp(db, { cliente: whatsapp, querWhatsApp: querWhatsApp(db) }), 0, 'não repete');

  salvarConfig(db, uid, 'vigia', { config: { whatsapp: false } });
  notificar(db, { usuarioId: uid, agente: 'vigia', tipo: 'mudanca', titulo: 'Outro aviso' });
  assert.equal(await enviarNotificacoesPorWhatsApp(db, { cliente: whatsapp, querWhatsApp: querWhatsApp(db) }), 0, 'preferência desligada');

  // Fila de editais (ex.: Prospector): envia e marca; erro 4xx não insiste.
  enviados.length = 0;
  db.prepare("INSERT INTO whatsapp_fila (usuario_id, oportunidade_id, origem) VALUES (?, ?, 'prospector')").run(uid, opId);
  assert.equal(await processarFilaWhatsApp(db, { cliente: whatsapp, fetchImpl: fakePncp }), 1);
  assert.equal(enviados[0].tipo, 'doc');
  assert.equal(await processarFilaWhatsApp(db, { cliente: whatsapp, fetchImpl: fakePncp }), 0);
  const ruim = { enviarAviso: async () => { throw Object.assign(new Error('bloqueado'), { status: 400 }); }, enviarDocumento: async () => { throw Object.assign(new Error('bloqueado'), { status: 400 }); } };
  db.prepare("INSERT INTO whatsapp_fila (usuario_id, oportunidade_id) VALUES (?, ?)").run(uid, opId);
  await processarFilaWhatsApp(db, { cliente: ruim, fetchImpl: fakePncp });
  assert.equal(db.prepare('SELECT tentativas FROM whatsapp_fila ORDER BY id DESC').get().tentativas, 3);

  const semMeta = await buildApp({ db, serveFrontend: false, ia: null, whatsapp: null });
  assert.equal((await semMeta.inject({ method: 'POST', url: '/api/whatsapp/teste', headers: { cookie } })).statusCode, 503);
});
