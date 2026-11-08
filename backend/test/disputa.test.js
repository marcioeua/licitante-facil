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

test('chat do pregoeiro: IA analisa o texto colado, cria lembretes e avisa no sino', async () => {
  const db = openDatabase(':memory:');
  const chamadas = [];
  const analise = {
    resumo: 'O pregoeiro convocou a LIMPA TUDO para enviar a proposta ajustada do item 1.',
    envolve_minha_empresa: true,
    mensagens: [{ data_hora: '05/11/2026 10:00:12', item: '1', tipo: 'convocacao', me_envolve: true, trecho: 'Convoco LIMPA TUDO a anexar proposta em 2 horas', explicacao: 'Você precisa anexar a proposta ajustada.' }],
    prazos: [
      { descricao: 'Anexar proposta ajustada do item 1', prazo_texto: '2 horas', limite: '2026-11-05T12:00', me_envolve: true },
      { descricao: 'Prazo sem hora', prazo_texto: 'em breve', limite: null, me_envolve: true },
      { descricao: 'Formato inválido', prazo_texto: 'x', limite: 'amanhã', me_envolve: false },
    ],
    acoes: ['Anexar a proposta ajustada no sistema até 12h'],
    alertas: [],
  };
  const ia = { beta: { messages: { parse: async (p) => { chamadas.push(p); return { parsed_output: analise, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }; } } } };
  const app = await buildApp({ db, serveFrontend: false, ia });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'p@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  const emp = (await req('POST', '/api/empresas', { razao_social: 'LIMPA TUDO LTDA', cnpj: '11222333000181' })).json();
  const neg = (await req('POST', '/api/negocios', { titulo: 'Pregão limpeza', empresa_id: emp.id })).json();

  assert.equal((await req('POST', `/api/disputa/negocio/${neg.id}/chat`, { texto: 'curto' })).statusCode, 400);
  const texto = '05/11/2026 10:00:12 - Pregoeiro: Convoco LIMPA TUDO a anexar proposta em 2 horas.';
  let r = await req('POST', `/api/disputa/negocio/${neg.id}/chat`, { texto });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().lembretes, 1, 'só prazos com data e hora válidas');
  const prompt = chamadas[0].messages[0].content;
  assert.match(prompt, /LIMPA TUDO LTDA \(CNPJ 11222333000181\)/);
  assert.match(prompt, /<chat_do_pregoeiro>[\s\S]*Convoco/);

  const agenda = (await req('GET', '/api/agenda?de=2026-11-01&ate=2026-11-30')).json();
  assert.ok(agenda.some((e) => e.tipo === 'evento' && e.inicio === '2026-11-05T12:00' && /proposta ajustada/.test(e.titulo)));
  const notifs = (await req('GET', '/api/notificacoes')).json();
  const lista = notifs.itens ?? notifs;
  assert.ok(lista.some((n) => n.tipo === 'prazo_pregoeiro' && n.link === `/negocios/${neg.id}/disputa`));

  await req('POST', `/api/disputa/negocio/${neg.id}/chat`, { texto });
  assert.equal(db.prepare("SELECT count(*) n FROM eventos").get().n, 1, 'não duplica o lembrete');
  const hist = (await req('GET', `/api/disputa/negocio/${neg.id}/chat`)).json();
  assert.equal(hist.analises.length, 2);
  assert.equal(hist.analises[0].analise.envolve_minha_empresa, true);
  assert.equal((await req('DELETE', `/api/disputa/chat/${hist.analises[0].id}`)).statusCode, 200);

  const semIA = await buildApp({ db, serveFrontend: false, ia: null });
  r = await semIA.inject({ method: 'POST', url: `/api/disputa/negocio/${neg.id}/chat`, payload: { texto }, headers: { cookie } });
  assert.equal(r.statusCode, 503);
});

test('agente fornecedor: termos do item, ranking de quem vendeu e contato público', async () => {
  const { termosDoItem, fornecedoresDoItem } = await import('../src/services/fornecedores.js');
  assert.equal(termosDoItem('Detergente líquido, neutro, frasco 500 ml'), 'detergente liquido');
  assert.equal(termosDoItem('Papel higiênico folha dupla, rolo 30 m'), 'papel higienico');

  const db = openDatabase(':memory:');
  const ins = db.prepare('INSERT INTO compra_itens (compra_controle, numero_item, descricao, unidade, quantidade, valor_unit_estimado, tem_resultado, resultado_buscado) VALUES (?, ?, ?, ?, 10, 5, 1, 1)');
  const res = db.prepare('INSERT INTO item_resultados (compra_controle, numero_item, sequencial, fornecedor_ni, fornecedor_nome, porte, quantidade, valor_unitario, valor_total, data_resultado) VALUES (?, ?, 1, ?, ?, ?, 10, ?, ?, ?)');
  const A = ['11222333000181', 'DISTRIBUIDORA ALFA'];
  const B = ['22333444000155', 'COMERCIAL BETA'];
  [['11111111000111-1-000001/2026', A, 2.5, 'SP'], ['11111111000111-1-000002/2026', A, 2.9, 'SP'], ['11111111000111-1-000003/2026', B, 2.1, 'MG']].forEach(([c, f, v], i) => {
    ins.run(c, 1, 'Detergente líquido neutro 500 ml', 'Frasco');
    res.run(c, 1, f[0], f[1], 'ME', v, v * 10, `2026-0${i + 1}-10`);
  });
  const r = await fornecedoresDoItem(db, 'Detergente líquido neutro 500 ml', { fetchImpl: async () => Response.json([]) });
  assert.deepEqual(r.fornecedores.map((f) => [f.nome, f.vitorias, f.menorPreco]), [['DISTRIBUIDORA ALFA', 2, 2.5], ['COMERCIAL BETA', 1, 2.1]]);
  assert.equal(r.fornecedores[0].precoMediano, 2.7);
  assert.equal(r.fornecedores[0].unidadePreco, 'FRASCO');

  const app = await buildApp({ db, serveFrontend: false, ia: null, fetchCnpj: async () => Response.json({ razao_social: 'DISTRIBUIDORA ALFA LTDA', email: 'VENDAS@ALFA.COM.BR', ddd_telefone_1: '(11) 3333-4444', municipio: 'SAO PAULO', uf: 'SP' }) });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'f@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const c = (await app.inject({ method: 'GET', url: `/api/disputa/fornecedores/${A[0]}/contato`, headers: { cookie } })).json();
  assert.deepEqual([c.email, c.telefone], ['vendas@alfa.com.br', '1133334444']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/disputa/fornecedores/123/contato', headers: { cookie } })).statusCode, 400);
});

test('agente fornecedor: assunto da licitação a partir do objeto', async () => {
  const { assuntoDoObjeto } = await import('../src/services/fornecedores.js');
  assert.equal(assuntoDoObjeto('Aquisição de material de limpeza para as unidades de saúde'), 'material limpeza');
  assert.equal(assuntoDoObjeto('Registro de preços para eventual aquisição de gêneros alimentícios'), 'generos alimenticios');
  assert.equal(assuntoDoObjeto('Contratação de empresa especializada em manutenção predial'), 'manutencao predial');
});

test('agente fornecedor: busca por produto na sala sem itens', async () => {
  const db = openDatabase(':memory:');
  const ins = db.prepare('INSERT INTO compra_itens (compra_controle, numero_item, descricao, unidade, quantidade, valor_unit_estimado, tem_resultado, resultado_buscado) VALUES (?, 1, ?, ?, 10, 5, 1, 1)');
  const res = db.prepare("INSERT INTO item_resultados (compra_controle, numero_item, sequencial, fornecedor_ni, fornecedor_nome, porte, quantidade, valor_unitario, valor_total, data_resultado) VALUES (?, 1, 1, ?, ?, 'ME', 10, ?, ?, '2026-10-01')");
  ins.run('11111111000111-1-000009/2026', 'Copo descartável 200 ml pacote com 100', 'Pacote');
  res.run('11111111000111-1-000009/2026', '11222333000181', 'COPOS BAHIA LTDA', 4.5, 45);
  const app = await buildApp({ db, serveFrontend: false, ia: null, fetchImpl: async () => Response.json([]) });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'l@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const neg = (await app.inject({ method: 'POST', url: '/api/negocios', payload: { titulo: 'Aquisição de copos descartáveis' }, headers: { cookie } })).json();
  assert.equal((await app.inject({ method: 'GET', url: `/api/disputa/negocio/${neg.id}/fornecedores?q=co`, headers: { cookie } })).statusCode, 400);
  const r = (await app.inject({ method: 'GET', url: `/api/disputa/negocio/${neg.id}/fornecedores?q=copo%20descartavel`, headers: { cookie } })).json();
  assert.deepEqual(r.fornecedores.map((f) => [f.nome, f.precoMediano]), [['COPOS BAHIA LTDA', 4.5]]);
});

test('zerar lances da sala mantém itens e custos', async () => {
  const db = openDatabase(':memory:');
  const app = await buildApp({ db, serveFrontend: false, ia: null });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'z@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  const neg = (await req('POST', '/api/negocios', { titulo: 'Teste' })).json();
  const it = (await req('POST', `/api/disputa/negocio/${neg.id}/itens`, { descricao: 'Copo', custo: 4, margem_minima: 0.1 })).json();
  await req('POST', `/api/disputa/itens/${it.id}/lances`, { tipo: 'meu', valor: 5.74 });
  assert.equal((await req('DELETE', `/api/disputa/negocio/${neg.id}/lances`)).statusCode, 200);
  const sala = (await req('GET', `/api/disputa/negocio/${neg.id}`)).json();
  assert.deepEqual([sala.itens[0].meu_lance, sala.itens[0].melhor_lance, sala.itens[0].situacao, sala.itens[0].lances.length, sala.itens[0].custo], [null, null, 'pendente', 0, 4]);
});
