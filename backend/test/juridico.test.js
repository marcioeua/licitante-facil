import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { prazoImpugnacao, AnaliseSchema } = await import('../src/services/juridico.js');
const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');

test('prazo de impugnação: 3 dias úteis antes da abertura (pula fim de semana)', () => {
  assert.equal(prazoImpugnacao('2026-11-18T09:00:00'), '2026-11-13'); // quarta -> sexta anterior
  assert.equal(prazoImpugnacao('2026-11-23T09:00:00'), '2026-11-18'); // segunda -> quarta anterior
  assert.equal(prazoImpugnacao(null), null);
  assert.equal(betaZodOutputFormat(AnaliseSchema).type, 'json_schema');
});

test('agente jurídico: análise do edital, rascunhos de peças, edição e isolamento entre usuários', async () => {
  const db = openDatabase(':memory:');
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: '11222333000181-1-000045/2026', objetoCompra: 'Material de limpeza', modalidadeId: 6,
    modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, numeroCompra: '90045', sequencialCompra: 45, srp: false, dataPublicacaoPncp: '2026-11-01T10:00:00',
    dataAberturaProposta: '2026-11-04T08:00:00', dataEncerramentoProposta: '2026-11-18T09:00:00', valorTotalEstimado: 5000,
    orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'PREFEITURA DE TESTE' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } })]);
  const opId = db.prepare('SELECT id FROM oportunidades').get().id;
  db.prepare("INSERT INTO edital_arquivos (oportunidade_id, ordem, nome, tipo, file_id, paginas, tamanho, expira_em) VALUES (?, 0, 'Edital.pdf', 'pdf', 'file_1', 20, 1000, datetime('now', '+10 days'))").run(opId);

  const chamadas = { parse: [], create: [] };
  const analise = { resumo: 'Edital com uma exigência restritiva.', pontos: [{ titulo: 'Atestado com 100% do quantitativo', gravidade: 'alta', onde: 'Item 9.3, p. 12', trecho: 'atestado de 100% do objeto', problema: 'Exigir 100% restringe a competição.', fundamento: 'Art. 67, § 2º, da Lei 14.133/2021', sugestao: 'impugnacao' }], ambiguidades: [] };
  const ia = { beta: { messages: {
    parse: async (r) => { chamadas.parse.push(r); return { parsed_output: analise, stop_reason: 'end_turn', usage: {}, model: r.model }; },
    create: async (r) => { chamadas.create.push(r); return { content: [{ type: 'text', text: '## IMPUGNAÇÃO AO EDITAL\n\nTexto da peça.\n\n## Pontos para o advogado conferir\n- Prazo' }], stop_reason: 'end_turn', usage: {}, model: r.model }; },
  } } };
  const app = await buildApp({ db, serveFrontend: false, ia });
  const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email, senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const cookie = await login('j@e.com');
  const outro = await login('k@e.com');
  const req = (method, url, payload, c = cookie) => app.inject({ method, url, payload, headers: { cookie: c } });
  const emp = (await req('POST', '/api/empresas', { razao_social: 'LIMPA TUDO LTDA', cnpj: '11222333000181' })).json();
  const neg = (await req('POST', '/api/negocios', { oportunidade_id: opId })).json();
  await req('PATCH', `/api/negocios/${neg.id}`, { empresa_id: emp.id });

  let info = (await req('GET', `/api/juridico?negocio=${neg.id}`)).json();
  assert.equal(info.negocio.prazo_impugnacao, '2026-11-13');
  assert.equal(info.iaDisponivel, true);

  let r = await req('POST', '/api/juridico/analise', { negocio_id: neg.id });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().conteudo.pontos[0].gravidade, 'alta');
  assert.equal(chamadas.parse[0].messages[0].content[0].source.file_id, 'file_1', 'manda o edital');

  r = await req('POST', '/api/juridico/pecas', { negocio_id: neg.id, tipo: 'impugnacao', fatos: 'Atestado de 100% do objeto (item 9.3)', representante: 'Fulano de Tal', cidade: 'Campinas/SP' });
  assert.equal(r.statusCode, 200, r.body);
  const peca = r.json();
  assert.match(peca.conteudo, /IMPUGNAÇÃO/);
  const prompt = chamadas.create[0].messages[0].content.at(-1).text;
  assert.match(prompt, /LIMPA TUDO LTDA, CNPJ 11222333000181/);
  assert.match(prompt, /Representante legal: Fulano de Tal/);
  assert.match(prompt, /art\. 164/);
  assert.match(chamadas.create[0].system, /NÃO cite números de acórdãos/);

  assert.equal((await req('POST', '/api/juridico/pecas', { negocio_id: neg.id, tipo: 'recurso', decisao: 'curto' })).statusCode, 400);
  r = await req('PATCH', `/api/juridico/pecas/${peca.id}`, { conteudo: 'Texto revisado pelo advogado' });
  assert.equal(r.json().conteudo, 'Texto revisado pelo advogado');
  assert.equal((await req('PATCH', `/api/juridico/pecas/${peca.id}`, { conteudo: 'x' }, outro)).statusCode, 404);
  assert.equal((await req('GET', `/api/juridico?negocio=${neg.id}`, null, outro)).statusCode, 404);
  assert.equal((await req('GET', '/api/juridico', null, outro)).json().pecas.length, 0);
  info = (await req('GET', `/api/juridico?negocio=${neg.id}`)).json();
  assert.deepEqual(info.pecas.map((p) => p.tipo), ['impugnacao', 'analise']);
  assert.equal((await req('DELETE', `/api/juridico/pecas/${peca.id}`)).statusCode, 200);

  const semIA = await buildApp({ db, serveFrontend: false, ia: null });
  assert.equal((await semIA.inject({ method: 'POST', url: '/api/juridico/analise', payload: { negocio_id: neg.id }, headers: { cookie } })).statusCode, 503);
});
