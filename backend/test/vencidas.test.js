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
});
