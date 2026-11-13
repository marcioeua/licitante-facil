import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { clienteTelegram, processarMensagensTelegram, enviarNotificacoesPorTelegram, processarFilaTelegram } = await import('../src/services/telegram.js');
const { notificar, querTelegram, salvarConfig, executarProspector } = await import('../src/services/agentes.js');

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\n%%EOF');

test('cliente da API de robôs do Telegram', async () => {
  const chamadas = [];
  const fake = async (url, init) => {
    chamadas.push({ url: String(url), init });
    if (String(url).endsWith('/getMe')) return Response.json({ ok: true, result: { username: 'BuscaPregaoBot' } });
    return Response.json({ ok: true, result: {} });
  };
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  try {
    const c = clienteTelegram({ fetchImpl: fake });
    assert.equal(await c.nomeDoRobo(), 'BuscaPregaoBot');
    await c.nomeDoRobo();
    assert.equal(chamadas.length, 1, 'guarda o nome do robô');
    await c.enviarTexto(99, '<b>Oi</b>');
    assert.match(chamadas[1].url, /api\.telegram\.org\/bot123:abc\/sendMessage$/);
    assert.deepEqual(JSON.parse(chamadas[1].init.body).parse_mode, 'HTML');
    await c.enviarDocumento(99, { bytes: pdf, nomeArquivo: 'Edital.pdf', legenda: 'x' });
    assert.ok(chamadas[2].init.body instanceof FormData);
    assert.equal(chamadas[2].init.body.get('document').name, 'Edital.pdf');
    const ruim = clienteTelegram({ fetchImpl: async () => Response.json({ ok: false, error_code: 401, description: 'Unauthorized' }, { status: 401 }) });
    await assert.rejects(ruim.enviarTexto(1, 'a'), (e) => e.status === 401);
  } finally {
    delete process.env.TELEGRAM_BOT_TOKEN;
  }
  assert.equal(clienteTelegram(), null);
});

test('Telegram no sistema: conectar pelo link, avisos, edital em PDF e fila do Prospector', async () => {
  const db = openDatabase(':memory:');
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '11222333000181-1-000045/2026', objetoCompra: 'Aquisição de material de limpeza', modalidadeId: 6,
    modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, numeroCompra: '90045', sequencialCompra: 45, srp: false, dataPublicacaoPncp: f(0),
    dataEncerramentoProposta: f(10), valorTotalEstimado: 48000, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA DE TESTE' },
    unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } })]);
  const opId = db.prepare('SELECT id FROM oportunidades').get().id;
  const enviados = [];
  let updates = [];
  const telegram = {
    nomeDoRobo: async () => 'BuscaPregaoBot',
    atualizacoes: async (offset) => updates.filter((u) => !offset || u.update_id >= offset),
    enviarTexto: async (chat, html) => { enviados.push({ tipo: 'texto', chat, html }); },
    enviarDocumento: async (chat, d) => { enviados.push({ tipo: 'doc', chat, ...d }); },
  };
  const fakePncp = async (url) => {
    const u = String(url);
    if (u.endsWith('/arquivos')) return Response.json([{ url: 'https://pncp.test/arq/1', tipoDocumentoId: 2, tipoDocumentoNome: 'Edital', sequencialDocumento: 1, statusAtivo: true }]);
    if (u.endsWith('/arq/1')) return new Response(pdf, { headers: { 'content-disposition': 'attachment; filename="Edital 90045.pdf"' } });
    return new Response(null, { status: 404 });
  };
  const app = await buildApp({ db, serveFrontend: false, ia: null, whatsapp: null, telegram, fetchImpl: fakePncp });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Marcio', email: 't@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  const uid = db.prepare('SELECT id FROM usuarios').get().id;

  assert.deepEqual((await req('GET', '/api/telegram')).json(), { servidor: true, conectado: false, ativo: false, desde: null });
  assert.equal((await req('POST', '/api/telegram/teste')).statusCode, 400);
  const { link } = (await req('POST', '/api/telegram/conectar')).json();
  const codigo = link.match(/^https:\/\/t\.me\/BuscaPregaoBot\?start=([\w-]+)$/)[1];

  updates = [
    { update_id: 10, message: { chat: { id: 555 }, text: '/start codigo-errado' } },
    { update_id: 11, message: { chat: { id: 777 }, text: `/start ${codigo}` } },
  ];
  const st = (await req('POST', '/api/telegram/verificar')).json();
  assert.deepEqual([st.conectado, st.ativo], [true, true]);
  assert.match(enviados[0].html, /Código inválido/);
  assert.match(enviados[1].html, /Pronto, Marcio!/);
  assert.equal(db.prepare('SELECT telegram_chat_id FROM usuarios').get().telegram_chat_id, '777');
  await processarMensagensTelegram(db, telegram);
  assert.equal(enviados.length, 2, 'não processa a mesma mensagem duas vezes');
  db.prepare("UPDATE usuarios SET telegram_desde = datetime('now', '-1 minute')").run();

  let r = await req('POST', `/api/telegram/edital/${opId}`);
  assert.deepEqual(r.json(), { documento: true, arquivo: 'Edital 90045.pdf' });
  const doc = enviados.at(-1);
  assert.equal(doc.chat, '777');
  assert.match(doc.legenda, /^📄 <b>Aquisição de material de limpeza<\/b>/);
  assert.match(doc.legenda, /PREFEITURA DE TESTE - Campinas\/SP\nPregão - Eletrônico nº 90045\/2026/);

  enviados.length = 0;
  notificar(db, { usuarioId: uid, agente: 'vigia', tipo: 'mudanca', titulo: 'Prazo <mudou>', mensagem: 'De 18/11 para 20/11', link: '/negocios/1' });
  db.prepare("UPDATE notificacoes SET criado_em = datetime('now')").run();
  assert.equal(await enviarNotificacoesPorTelegram(db, { cliente: telegram, querTelegram: querTelegram(db), appUrl: 'https://app.x' }), 1);
  assert.match(enviados[0].html, /🔔 <b>Prazo &lt;mudou&gt;<\/b>/);
  assert.match(enviados[0].html, /href="https:\/\/app\.x\/#\/negocios\/1"/);
  salvarConfig(db, uid, 'vigia', { config: { telegram: false } });
  notificar(db, { usuarioId: uid, agente: 'vigia', tipo: 'mudanca', titulo: 'Outro' });
  assert.equal(await enviarNotificacoesPorTelegram(db, { cliente: telegram, querTelegram: querTelegram(db) }), 0);

  // Prospector: licitação nova -> fila do Telegram (WhatsApp desligado não envia).
  enviados.length = 0;
  db.prepare("INSERT INTO alertas (usuario_id, nome, palavras) VALUES (?, 'Limpeza', 'material de limpeza')").run(uid);
  salvarConfig(db, uid, 'prospector', { ativo: true, config: { notaMinima: 0 } });
  executarProspector(db, uid);
  assert.deepEqual(db.prepare("SELECT canal FROM whatsapp_fila WHERE origem = 'prospector' ORDER BY canal").all().map((x) => x.canal), ['telegram', 'whatsapp']);
  assert.equal(await processarFilaTelegram(db, { cliente: telegram, fetchImpl: fakePncp }), 1);
  assert.equal(enviados[0].tipo, 'doc');

  // /parar desliga.
  updates = [{ update_id: 12, message: { chat: { id: 777 }, text: '/parar' } }];
  await processarMensagensTelegram(db, telegram);
  assert.equal(db.prepare('SELECT telegram_ativo FROM usuarios').get().telegram_ativo, 0);
});

test('token colado com espaço, aspas ou "bot" na frente é limpo', async () => {
  const urls = [];
  process.env.TELEGRAM_BOT_TOKEN = ' "bot123:ABC-def"\n';
  try {
    const c = clienteTelegram({ fetchImpl: async (u) => { urls.push(String(u)); return Response.json({ ok: true, result: { username: 'x' } }); } });
    await c.nomeDoRobo();
    assert.equal(urls[0], 'https://api.telegram.org/bot123:ABC-def/getMe');
  } finally {
    delete process.env.TELEGRAM_BOT_TOKEN;
  }
});

test('Telegram: licitação nova chega com botão "Ler este edital" e o botão lê mesmo com o Leitor desligado', async () => {
  const { lerEditalPeloTelegram } = await import('../src/jobs/agendador.js');
  const db = openDatabase(':memory:');
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '11222333000181-1-000046/2026', objetoCompra: 'Aquisição de material de limpeza', modalidadeId: 6,
    modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, numeroCompra: '90046', sequencialCompra: 46, srp: false, dataPublicacaoPncp: f(0),
    dataEncerramentoProposta: f(10), valorTotalEstimado: 1000, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } })]);
  const opId = db.prepare('SELECT id FROM oportunidades').get().id;
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, telegram_chat_id, telegram_ativo) VALUES ('M', 'm@e.com', 'x', '777', 1)").run();
  const uid = db.prepare('SELECT id FROM usuarios').get().id;
  db.prepare("INSERT INTO alertas (usuario_id, nome, palavras) VALUES (?, 'Limpeza', 'material de limpeza')").run(uid);
  // PDF desligado: no Telegram vai mesmo assim (texto + botão); WhatsApp não.
  salvarConfig(db, uid, 'prospector', { ativo: true, config: { notaMinima: 0, whatsappEdital: false } });
  executarProspector(db, uid);
  const fila = db.prepare("SELECT canal, negocio_id, com_pdf FROM whatsapp_fila").all();
  const negocioId = db.prepare('SELECT id FROM negocios').get().id;
  assert.deepEqual(fila.map((x) => ({ ...x })), [{ canal: 'telegram', negocio_id: negocioId, com_pdf: 0 }]);

  const enviados = [];
  const respostas = [];
  let updates = [];
  const telegram = {
    atualizacoes: async (offset) => updates.filter((u) => !offset || u.update_id >= offset),
    enviarTexto: async (chat, html, op = {}) => { enviados.push({ chat, html, teclado: op.teclado }); },
    enviarDocumento: async () => { throw new Error('não devia mandar PDF'); },
    responderBotao: async (id, texto) => { respostas.push(texto); },
  };
  assert.equal(await processarFilaTelegram(db, { cliente: telegram, fetchImpl: async () => new Response(null, { status: 404 }) }), 1);
  assert.match(enviados[0].html, /Nova licitação na sua triagem/);
  assert.equal(enviados[0].teclado[0][0].callback_data, `ler:${negocioId}`);

  // Toque no botão: responde na hora e pede a leitura.
  const pedidos = [];
  updates = [{ update_id: 50, callback_query: { id: 'cb1', data: `ler:${negocioId}`, message: { chat: { id: 777 } } } },
    { update_id: 51, callback_query: { id: 'cb2', data: `ler:${negocioId}`, message: { chat: { id: 999 } } } }];
  await processarMensagensTelegram(db, telegram, { aoPedirLeitura: (p) => pedidos.push(p) });
  await new Promise((r) => setTimeout(r, 10));
  assert.match(respostas[0], /Lendo o edital/);
  assert.match(respostas[1], /não está ligada/, 'outra conversa não pode ler negócio alheio');
  assert.deepEqual(pedidos.map((p) => [p.uid, p.negocioId]), [[uid, negocioId]]);

  // A leitura (Agente Leitor desligado) manda o resultado na conversa.
  db.prepare("INSERT INTO edital_resumos (oportunidade_id, resumo, modelo) VALUES (?, ?, 'teste')").run(opId, JSON.stringify({ resumo: 'Compra de limpeza', documentos_habilitacao: [{ grupo: 'fiscal_trabalhista', descricao: 'CND federal' }], pontos_atencao: ['Amostra em 3 dias'] }));
  enviados.length = 0;
  await lerEditalPeloTelegram(db, { uid, negocioId, chatId: 777 }, { cliente: telegram, ia: {}, appUrl: 'https://app.x' });
  assert.match(enviados[0].html, /📖 <b>Edital lido/);
  assert.match(enviados[0].html, /Amostra em 3 dias/);
  assert.match(enviados[0].html, /oportunidades\/\d+\?ver=edital/);
  assert.equal(db.prepare("SELECT enviada_telegram FROM notificacoes WHERE agente = 'leitor'").get().enviada_telegram, 1, 'não repete pelo aviso normal');
});
