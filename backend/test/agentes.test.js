import { test } from 'node:test';
import assert from 'node:assert/strict';

const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { pontuar, executarProspector, executarVigia, executarLeitor, salvarConfig, enviarNotificacoesPorEmail } = await import('../src/services/agentes.js');
const { executarAgentesAgendados } = await import('../src/jobs/agendador.js');

const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
const op = (seq, objeto, extra = {}) => ({
  numeroControlePNCP: `A-${seq}`, objetoCompra: objeto, modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, sequencialCompra: seq,
  orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'MUNICIPIO X', esferaId: 'F' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' },
  dataPublicacaoPncp: f(-1), dataAberturaProposta: f(0), dataEncerramentoProposta: f(10), valorTotalEstimado: 50000, situacaoCompraNome: 'Divulgada no PNCP',
  ...extra,
});

async function preparar() {
  const db = openDatabase(':memory:');
  const app = await buildApp({ db, serveFrontend: false, ia: null });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'ag@e.com', senha: 'senha-segura-1' } });
  const cookie = cad.headers['set-cookie'].split(';')[0];
  const uid = cad.json().id;
  return { db, app, cookie, uid };
}

test('pontuação explica a nota', async () => {
  const { db } = await preparar();
  upsertOportunidades(db, [mapContratacao(op(1, 'Aquisição de material de limpeza e higiene'))]);
  const o = db.prepare('SELECT * FROM oportunidades').get();
  const p = pontuar(db, o, { palavras: 'material de limpeza', valor_min: null, valor_max: null });
  assert.equal(p.nota, 35 + 10 + 20 + 8 + 18); // palavras no início, prazo bom, sem faixa de valor, órgão federal
  assert.ok(p.motivos.includes('As palavras do alerta são o objeto principal da compra'));
  const faixa = pontuar(db, o, { palavras: 'material de limpeza', valor_min: 10000, valor_max: 100000 });
  assert.equal(faixa.nota, p.nota + 7);
  const curto = pontuar(db, { ...o, data_encerramento: f(1) }, { palavras: 'limpeza, notebook computador' });
  assert.ok(curto.nota < p.nota);
});

test('Prospector coloca as melhores no funil, com checklist, sem repetir', async () => {
  const { db, uid } = await preparar();
  let r = executarProspector(db, uid);
  assert.match(r.aviso, /Crie pelo menos um alerta/);
  db.prepare("INSERT INTO alertas (usuario_id, nome, palavras) VALUES (?, 'Limpeza', 'material de limpeza')").run(uid);
  upsertOportunidades(db, [
    op(1, 'Aquisição de material de limpeza'),
    op(2, 'Material de limpeza hospitalar', { dataEncerramentoProposta: f(0.5) }),
    op(3, 'Notebooks'),
  ].map(mapContratacao));
  db.prepare("UPDATE oportunidades SET importado_em = datetime('now')").run();
  salvarConfig(db, uid, 'prospector', { ativo: true, config: { notaMinima: 75 } });
  r = executarProspector(db, uid);
  assert.equal(r.adicionadas, 1, 'só a de prazo bom passa da nota mínima');
  const n = db.prepare('SELECT * FROM negocios').get();
  assert.equal(n.origem, 'prospector');
  assert.match(n.notas, /Agente Prospector \(nota \d+/);
  assert.ok(db.prepare('SELECT count(*) AS c FROM checklist_itens WHERE negocio_id = ?').get(n.id).c >= 5);
  assert.equal(db.prepare("SELECT count(*) AS c FROM notificacoes WHERE agente = 'prospector'").get().c, 1);
  db.prepare("UPDATE agentes_config SET ultima_execucao = '2000-01-01 00:00:00'").run();
  assert.equal(executarProspector(db, uid).adicionadas, 0, 'não adiciona de novo a mesma licitação');
});

test('Vigia detecta mudanças, documentos novos e lembra 24h antes', async () => {
  const { db, uid } = await preparar();
  upsertOportunidades(db, [mapContratacao(op(5, 'Material de limpeza'))]);
  const o = db.prepare('SELECT * FROM oportunidades').get();
  const neg = db.prepare("INSERT INTO negocios (usuario_id, oportunidade_id, titulo, data_disputa) VALUES (?, ?, 'Limpeza', ?) RETURNING id").get(uid, o.id, o.data_encerramento).id;
  salvarConfig(db, uid, 'vigia', { ativo: true });
  let arquivos = [{ sequencialDocumento: 1, tipoDocumentoNome: 'Edital', titulo: 'edital', statusAtivo: true }];
  const fake = async () => Response.json(arquivos);

  let r = await executarVigia(db, uid, { fetchImpl: fake });
  assert.deepEqual(r, { acompanhadas: 1, mudancas: 0, lembretes: 0 }, 'primeira passada só tira a foto');

  const novoPrazo = f(15);
  db.prepare("UPDATE oportunidades SET data_encerramento = ?, situacao = 'Suspensa'").run(novoPrazo);
  arquivos = [...arquivos, { sequencialDocumento: 2, tipoDocumentoNome: 'Aviso de Retificação', titulo: 'retif', statusAtivo: true }];
  r = await executarVigia(db, uid, { fetchImpl: fake });
  assert.equal(r.mudancas, 2);
  const notifs = db.prepare("SELECT tipo, titulo, mensagem FROM notificacoes WHERE agente = 'vigia' ORDER BY id").all();
  assert.equal(notifs[0].tipo, 'mudanca_grave');
  assert.match(notifs[0].mensagem, /Situação: Divulgada no PNCP → Suspensa/);
  assert.match(notifs[1].mensagem, /Aviso de Retificação/);
  assert.equal(db.prepare('SELECT data_disputa FROM negocios WHERE id = ?').get(neg).data_disputa, novoPrazo, 'acompanha o novo prazo');

  db.prepare('UPDATE negocios SET data_disputa = ? WHERE id = ?').run(f(0.5), neg);
  r = await executarVigia(db, uid, { fetchImpl: fake });
  assert.equal(r.lembretes, 1);
  r = await executarVigia(db, uid, { fetchImpl: fake });
  assert.equal(r.lembretes, 0, 'lembra uma vez só');
});

test('Leitor: sem IA avisa; com IA lê, completa o checklist e respeita o limite', async () => {
  const { db, uid } = await preparar();
  assert.match((await executarLeitor(db, uid, { client: null })).aviso, /não está configurada/);
  upsertOportunidades(db, [op(7, 'A'), op(8, 'B')].map(mapContratacao));
  for (const o of db.prepare('SELECT id FROM oportunidades').all()) {
    db.prepare("INSERT INTO negocios (usuario_id, oportunidade_id, titulo) VALUES (?, ?, 'X')").run(uid, o.id);
  }
  salvarConfig(db, uid, 'leitor', { ativo: true, config: { maxPorDia: 1 } });
  const resumir = async () => ({ resumo: { resumo: 'Compra de A', documentos_habilitacao: [{ grupo: 'fiscal_trabalhista', descricao: 'CND federal' }], pontos_atencao: ['Amostra'] } });
  let r = await executarLeitor(db, uid, { client: {}, resumir });
  assert.equal(r.lidos, 1);
  assert.equal(db.prepare("SELECT count(*) AS c FROM checklist_itens WHERE texto = 'Documento: CND federal'").get().c, 1);
  r = await executarLeitor(db, uid, { client: {}, resumir });
  assert.equal(r.lidos, 0, 'limite diário');
  // Só um edital, a pedido: lê aquele (mesmo com o limite diário) e não duplica o checklist.
  const [n1, n2] = db.prepare('SELECT id FROM negocios ORDER BY id').all().map((x) => x.id);
  const lidosAntes = db.prepare("SELECT negocio_id FROM notificacoes WHERE agente = 'leitor'").all().map((x) => x.negocio_id);
  const alvo = lidosAntes.includes(n1) ? n2 : n1;
  r = await executarLeitor(db, uid, { client: {}, resumir, negocioId: alvo });
  assert.deepEqual([r.lidos, r.pendentes, r.negocioId], [1, 1, alvo]);
  await executarLeitor(db, uid, { client: {}, resumir, negocioId: alvo });
  assert.equal(db.prepare("SELECT count(*) AS c FROM checklist_itens WHERE negocio_id = ? AND texto = 'Documento: CND federal'").get(alvo).c, 1);
  await assert.rejects(executarLeitor(db, uid, { client: {}, resumir, negocioId: 999 }), /não encontrado/);
  // Leitura automática desligada: o agendador não lê nada.
  salvarConfig(db, uid, 'leitor', { config: { automatico: false, maxPorDia: 20 } });
  db.prepare("DELETE FROM notificacoes WHERE agente = 'leitor'").run(); // todos pendentes de novo
  r = await executarLeitor(db, uid, { client: {}, resumir, agendado: true });
  assert.equal(r.lidos, 0);
  assert.ok(r.automaticoDesligado);
});

test('API de agentes e notificações; agendamento e e-mail', async () => {
  const { db, app, cookie, uid } = await preparar();
  const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });
  let r = (await req('GET', '/api/agentes')).json();
  assert.deepEqual(r.map((a) => [a.id, a.ativo]), [['prospector', false], ['vigia', false], ['leitor', false]]);
  r = (await req('PUT', '/api/agentes/vigia', { ativo: true, config: { lembrete24h: false, inventado: 1 } })).json();
  assert.equal(r.ativo, true);
  assert.equal(r.config.lembrete24h, false);
  assert.equal(r.config.inventado, undefined);
  assert.equal((await req('PUT', '/api/agentes/xyz', { ativo: true })).statusCode, 404);
  r = (await req('POST', '/api/agentes/prospector/executar')).json();
  assert.match(r.aviso, /alerta/);

  db.prepare("INSERT INTO notificacoes (usuario_id, agente, tipo, titulo) VALUES (?, 'vigia', 'mudanca', 'Mudou')").run(uid);
  r = (await req('GET', '/api/notificacoes')).json();
  assert.equal(r.naoLidas, 1);
  await req('POST', '/api/notificacoes/lidas', { todas: true });
  assert.equal((await req('GET', '/api/notificacoes')).json().naoLidas, 0);

  // Agendamento: vigia roda para quem está ligado e só de novo depois de 2h.
  const agora = new Date('2026-11-05T13:00:00Z'); // 10h em Brasília
  await executarAgentesAgendados(db, { agora, log: () => {}, fetchImpl: async () => Response.json([]) });
  assert.ok(db.prepare("SELECT ultima_execucao FROM agentes_config WHERE agente = 'vigia'").get().ultima_execucao);
  assert.equal(db.prepare("SELECT ultima_execucao FROM tarefas WHERE nome = 'agente_prospector'").get().ultima_execucao, '2026-11-05');

  const enviados = [];
  const n = await enviarNotificacoesPorEmail(db, { transport: { sendMail: async (m) => enviados.push(m) } });
  assert.equal(n, 1);
  assert.match(enviados[0].subject, /aviso\(s\) dos seus agentes/);
  assert.equal(await enviarNotificacoesPorEmail(db, { transport: { sendMail: async () => {} } }), 0, 'não reenvia');
});
