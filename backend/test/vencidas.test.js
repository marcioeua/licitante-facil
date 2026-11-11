import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { executarProspector, salvarConfig, arquivarVencidas } = await import('../src/services/agentes.js');

// Datas no horário local do servidor, no formato do PNCP.
const local = (horas) => {
  const d = new Date(Date.now() + horas * 3600000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};

test('licitação vencida não entra na triagem e sai dela quando o prazo acaba', async () => {
  const db = openDatabase(':memory:');
  const op = (n, horas) => ({ numeroControlePNCP: n, objetoCompra: `Material de limpeza ${n}`, modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico',
    anoCompra: 2026, sequencialCompra: Number(n.slice(1)), srp: false, dataPublicacaoPncp: local(-1), dataEncerramentoProposta: local(horas),
    valorTotalEstimado: 1000, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'P' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } });
  upsertOportunidades(db, [op('A1', 72), op('A2', -2), op('A3', 5), op('A4', -3)].map(mapContratacao));
  const id = (n) => db.prepare('SELECT id FROM oportunidades WHERE numero_controle_pncp = ?').get(n).id;
  const app = await buildApp({ db, serveFrontend: false, ia: null, whatsapp: null, telegram: null });
  const cookie = (await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'v@e.com', senha: 'senha-segura-1' } })).headers['set-cookie'].split(';')[0];
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  const uid = db.prepare('SELECT id FROM usuarios').get().id;

  // Manual: encerrada não entra.
  const r = await req('POST', '/api/negocios', { oportunidade_id: id('A2') });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().erro, /prazo de propostas desta licitação terminou/);
  assert.equal((await req('POST', '/api/negocios', { oportunidade_id: id('A1') })).statusCode, 201);

  // Prospector: só as que têm 24h ou mais até o fim das propostas.
  db.prepare("INSERT INTO alertas (usuario_id, nome, palavras) VALUES (?, 'Limpeza', 'material de limpeza')").run(uid);
  db.prepare('DELETE FROM negocios').run();
  salvarConfig(db, uid, 'prospector', { ativo: true, config: { notaMinima: 0 } });
  executarProspector(db, uid);
  assert.deepEqual(db.prepare('SELECT o.numero_controle_pncp AS n FROM negocios g JOIN oportunidades o ON o.id = g.oportunidade_id').all().map((x) => x.n), ['A1']);

  // Prazo acabou com a licitação na triagem: arquiva sozinho (e só na triagem).
  db.prepare("INSERT INTO negocios (usuario_id, oportunidade_id, titulo, etapa) VALUES (?, ?, 'na triagem', 'triagem'), (?, ?, 'em disputa', 'disputa')")
    .run(uid, id('A2'), uid, id('A4'));
  const lista = (await req('GET', '/api/negocios')).json();
  assert.deepEqual(lista.map((n) => n.titulo).sort(), ['Material de limpeza A1', 'em disputa']);
  const arq = db.prepare("SELECT arquivado, notas FROM negocios WHERE titulo = 'na triagem'").get();
  assert.equal(arq.arquivado, 1);
  assert.match(arq.notas, /Arquivado automaticamente: o prazo de propostas terminou em \d{2}\/\d{2}\/\d{4}\./);
  assert.equal(arquivarVencidas(db), 0, 'não repete');

  // Compra direta sem prazo de propostas (dispensa "sem disputa"): não é aberta, não entra e sai da triagem.
  upsertOportunidades(db, [mapContratacao({ ...op('A5', 1), dataEncerramentoProposta: null, objetoCompra: 'Pagamento de passagem aérea' })]);
  assert.equal((await req('GET', '/api/oportunidades?q=passagem')).json().total, 0);
  assert.match((await req('POST', '/api/negocios', { oportunidade_id: id('A5') })).json().erro, /não recebe propostas/);
  db.prepare("INSERT INTO negocios (usuario_id, oportunidade_id, titulo, etapa) VALUES (?, ?, 'passagem', 'triagem')").run(uid, id('A5'));
  await req('GET', '/api/negocios');
  assert.match(db.prepare("SELECT notas FROM negocios WHERE titulo = 'passagem'").get().notas, /não recebe propostas/);

  // Atualizações do PNCP: novas sem prazo de propostas não são importadas.
  const n = upsertOportunidades(db, [mapContratacao({ ...op('A6', 1), dataEncerramentoProposta: null })], { soAbertasOuConhecidas: true });
  assert.equal(n, 0);
});

test('filtro de data em Oportunidades: prazo, abertura e publicação', async () => {
  const { buscarOportunidades } = await import('../src/services/busca.js');
  const db = openDatabase(':memory:');
  const op = (n, enc, pub) => ({ numeroControlePNCP: n, objetoCompra: `Ventilador ${n}`, modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico',
    anoCompra: 2026, sequencialCompra: Number(n.slice(1)), srp: false, dataPublicacaoPncp: pub, dataAberturaProposta: pub, dataEncerramentoProposta: enc,
    valorTotalEstimado: 1000, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'P' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } });
  upsertOportunidades(db, [op('B1', '2099-03-10T09:00:00', '2099-03-01T08:00:00'), op('B2', '2099-03-11T23:59:00', '2099-03-05T08:00:00'), op('B3', '2099-03-20T09:00:00', '2099-03-05T10:00:00')].map(mapContratacao));
  const nums = (f) => buscarOportunidades(db, f).itens.map((o) => o.numero_controle_pncp).sort();
  assert.deepEqual(nums({ dataDe: '2099-03-10', dataAte: '2099-03-11' }), ['B1', 'B2'], 'prazo de propostas (padrão), até inclui o dia todo');
  assert.deepEqual(nums({ dataAte: '2099-03-10' }), ['B1']);
  assert.deepEqual(nums({ dataTipo: 'publicacao', dataDe: '2099-03-05', dataAte: '2099-03-05' }), ['B2', 'B3']);
  assert.deepEqual(nums({ dataTipo: 'abertura', dataDe: '2099-03-02' }), ['B2', 'B3']);
  assert.deepEqual(nums({ dataDe: 'xx' }), ['B1', 'B2', 'B3'], 'data inválida é ignorada');
});
