import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');

test('assistente no sistema: ciclo de ferramentas, histórico intacto, custo e conversas', async () => {
  const db = openDatabase(':memory:');
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '11222333000181-1-000045/2026', objetoCompra: 'Aquisição de material de limpeza', modalidadeId: 6,
    modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, sequencialCompra: 45, srp: false, dataPublicacaoPncp: f(-1), dataEncerramentoProposta: f(10),
    valorTotalEstimado: 48000, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA DE TESTE' }, unidadeOrgao: { ufSigla: 'MG', municipioNome: 'Uberaba' } })]);
  const opId = db.prepare('SELECT id FROM oportunidades').get().id;

  const pedidos = [];
  const roteiro = [
    { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig1' }, { type: 'text', text: 'Vou buscar.' },
      { type: 'tool_use', id: 't1', name: 'buscar_licitacoes', input: { texto: 'limpeza', ufs: ['MG'], valor_max: 100000 } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Encontrei 1 pregão: material de limpeza em Uberaba/MG ([abrir](https://x/#/oportunidades/1)).' }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'adicionar_ao_funil', input: { id: opId } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pronto, coloquei no seu funil.' }] },
  ];
  const ia = { beta: { messages: { create: async (p) => { pedidos.push(structuredClone(p)); return { ...roteiro[pedidos.length - 1], model: p.model, usage: { input_tokens: 1000, output_tokens: 100 } }; } } } };
  const app = await buildApp({ db, serveFrontend: false, ia, whatsapp: null, telegram: null });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Marcio', email: 'a@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie, host: 'app.exemplo.com.br' } });

  let r = await req('POST', '/api/assistente/mensagens', { mensagem: 'pregões de limpeza em MG até 100 mil' });
  assert.equal(r.statusCode, 200, r.body);
  let j = r.json();
  assert.deepEqual(j.mensagens.map((m) => [m.papel, m.texto, m.ferramentas ?? null]), [
    ['user', 'pregões de limpeza em MG até 100 mil', null],
    ['assistant', 'Vou buscar.', ['Buscou licitações']],
    ['assistant', 'Encontrei 1 pregão: material de limpeza em Uberaba/MG ([abrir](https://x/#/oportunidades/1)).', []],
  ]);
  assert.equal(pedidos.length, 2);
  assert.ok(pedidos[0].tools.some((t) => t.name === 'meus_negocios' && t.input_schema.type === 'object'));
  assert.match(pedidos[0].system, /Marcio/);
  const resultado = pedidos[1].messages[2].content[0];
  assert.equal(resultado.type, 'tool_result');
  assert.match(resultado.content, /material de limpeza/i);
  assert.deepEqual(pedidos[1].messages[1].content[0], { type: 'thinking', thinking: '', signature: 'sig1' }, 'raciocínio volta intacto');

  // Continua a mesma conversa: histórico completo + nova pergunta; ferramenta do sistema adiciona ao funil.
  r = await req('POST', '/api/assistente/mensagens', { conversaId: j.conversaId, mensagem: 'coloca no meu funil' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(pedidos[2].messages.length, 5);
  assert.equal(db.prepare('SELECT count(*) n FROM negocios').get().n, 1);
  assert.deepEqual(r.json().mensagens.at(-1).texto, 'Pronto, coloquei no seu funil.');

  const conv = (await req('GET', `/api/assistente/conversas/${j.conversaId}`)).json();
  assert.equal(conv.mensagens.filter((m) => m.papel === 'user').length, 2, 'resultados de ferramenta não aparecem');
  assert.equal((await req('GET', '/api/assistente/conversas')).json().conversas[0].titulo, 'pregões de limpeza em MG até 100 mil');
  const uso = (await req('GET', '/api/ia/uso')).json();
  assert.equal(uso.porTipo[0].nome, 'Assistente (chat no sistema)');
  assert.equal(uso.porTipo[0].usos, 4);
  assert.match(uso.itens[0].titulo, /^Conversa: /);

  const outro = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Outro', email: 'b@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  assert.equal((await app.inject({ method: 'GET', url: `/api/assistente/conversas/${j.conversaId}`, headers: { cookie: outro } })).statusCode, 404);
  assert.equal((await req('DELETE', `/api/assistente/conversas/${j.conversaId}`)).statusCode, 200);
  assert.equal(db.prepare('SELECT count(*) n FROM assistente_mensagens').get().n, 0);

  const semIA = await buildApp({ db, serveFrontend: false, ia: null, whatsapp: null, telegram: null });
  assert.equal((await semIA.inject({ method: 'POST', url: '/api/assistente/mensagens', payload: { mensagem: 'oi' }, headers: { cookie } })).statusCode, 503);
});
