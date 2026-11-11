import { test } from 'node:test';
import assert from 'node:assert/strict';
const { categoriaDaExigencia, conferirHabilitacao, resumoHabilitacao, habilitacaoDoNegocio, ajustarHabilitacao } = await import('../src/services/habilitacao.js');
const { openDatabase } = await import('../src/db/index.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');

test('classifica as exigências do edital', () => {
  const casos = {
    'Prova de regularidade perante a Fazenda Federal e Dívida Ativa da União (certidão conjunta RFB/PGFN)': 'certidao_federal',
    'Certificado de Regularidade do FGTS (CRF)': 'fgts',
    'Certidão Negativa de Débitos Trabalhistas (CNDT)': 'trabalhista',
    'Prova de regularidade com a Fazenda Estadual': 'certidao_estadual',
    'Prova de regularidade com a Fazenda Municipal do domicílio': 'certidao_municipal',
    'Certidão negativa de falência e recuperação judicial': 'falencia',
    'Inscrição no CNPJ': 'cnpj',
    'Ato constitutivo, estatuto ou contrato social em vigor': 'contrato_social',
    'Balanço patrimonial e demonstrações contábeis do último exercício': 'balanco',
    'Atestado de capacidade técnica compatível com o objeto': 'atestado_tecnico',
    'Declaração de que não emprega menor de 18 anos': 'declaracao',
    'Registro no Conselho Regional de Química (CRQ)': 'registro_conselho',
    'Alvará sanitário': 'alvara',
    'Amostra do produto': null,
  };
  for (const [d, cat] of Object.entries(casos)) assert.equal(categoriaDaExigencia(d), cat, d);
});

test('confere validade na data da sessão e diz se está apto', () => {
  const exigencias = [
    { grupo: 'fiscal_trabalhista', descricao: 'CND federal' },
    { grupo: 'fiscal_trabalhista', descricao: 'Regularidade do FGTS' },
    { grupo: 'fiscal_trabalhista', descricao: 'CNDT' },
    { grupo: 'juridica', descricao: 'Contrato social' },
    { grupo: 'tecnica', descricao: 'Atestado de capacidade técnica' },
    { grupo: 'outros', descricao: 'Declaração de pleno atendimento' },
  ];
  const documentos = [
    { id: 1, nome: 'CND Federal', categoria: 'certidao_federal', validade: '2026-12-31' },
    { id: 2, nome: 'CRF antigo', categoria: 'fgts', validade: '2026-10-01' },
    { id: 3, nome: 'CRF', categoria: 'fgts', validade: '2026-11-10' },
    { id: 4, nome: 'CNDT', categoria: 'trabalhista', validade: '2026-11-01' },
    { id: 5, nome: 'Contrato social', categoria: 'contrato_social', validade: null },
  ];
  const h = conferirHabilitacao({ exigencias, documentos, dataSessao: '2026-11-18T09:00:00', hoje: '2026-11-06' });
  assert.deepEqual(h.itens.map((i) => i.situacao), ['ok', 'vence', 'vencido', 'ok', 'falta', 'declaracao']);
  assert.equal(h.itens[1].documento.nome, 'CRF', 'usa o que vale por mais tempo');
  assert.equal(h.apto, false);
  assert.equal(h.pendentes, 3);
  const msg = resumoHabilitacao({ lido: true, ...h });
  assert.match(msg, /falta: Atestado de capacidade técnica/);
  assert.match(msg, /vencido: Certidão trabalhista/);
  assert.match(msg, /vence antes da sessão: Regularidade do FGTS/);

  const ok = conferirHabilitacao({ exigencias: exigencias.slice(0, 1), documentos, dataSessao: '2026-11-18', hoje: '2026-11-06' });
  assert.equal(ok.apto, true);
  assert.match(resumoHabilitacao({ lido: true, ...ok }), /você está apto/);
});

test('conferência do negócio usa os documentos da empresa e o edital lido', () => {
  const db = openDatabase(':memory:');
  upsertOportunidades(db, [mapContratacao({ numeroControlePNCP: 'X-1', objetoCompra: 'Limpeza', modalidadeId: 6, anoCompra: 2026, sequencialCompra: 1, srp: false,
    dataPublicacaoPncp: '2026-11-01T10:00:00', dataEncerramentoProposta: '2099-11-18T09:00:00', orgaoEntidade: { cnpj: '1', razaoSocial: 'P' }, unidadeOrgao: { ufSigla: 'SP' } })]);
  const op = db.prepare('SELECT id FROM oportunidades').get().id;
  const uid = db.prepare("INSERT INTO usuarios (nome, email, senha_hash) VALUES ('a', 'a@a', 'x') RETURNING id").get().id;
  const e1 = db.prepare("INSERT INTO empresas (usuario_id, razao_social, cnpj) VALUES (?, 'E1', '1') RETURNING id").get(uid).id;
  const e2 = db.prepare("INSERT INTO empresas (usuario_id, razao_social, cnpj) VALUES (?, 'E2', '2') RETURNING id").get(uid).id;
  const neg = db.prepare("INSERT INTO negocios (usuario_id, oportunidade_id, empresa_id, titulo) VALUES (?, ?, ?, 'x') RETURNING id").get(uid, op, e1).id;
  assert.equal(habilitacaoDoNegocio(db, uid, neg).lido, false);
  db.prepare("INSERT INTO edital_resumos (oportunidade_id, resumo, modelo) VALUES (?, ?, 'm')").run(op, JSON.stringify({ documentos_habilitacao: [{ grupo: 'fiscal_trabalhista', descricao: 'CNDT' }] }));
  db.prepare("INSERT INTO documentos (usuario_id, empresa_id, nome, categoria, validade) VALUES (?, ?, 'CNDT da outra empresa', 'trabalhista', '2099-12-31')").run(uid, e2);
  assert.equal(habilitacaoDoNegocio(db, uid, neg).itens[0].situacao, 'falta', 'documento de outra empresa não vale');
  db.prepare("INSERT INTO documentos (usuario_id, empresa_id, nome, categoria, validade) VALUES (?, ?, 'CNDT', 'trabalhista', '2099-12-31')").run(uid, e1);
  assert.equal(habilitacaoDoNegocio(db, uid, neg).apto, true);
  assert.equal(habilitacaoDoNegocio(db, uid + 1, neg), null);
});

test('exigência com várias certidões juntas, "e/ou" e itens marcados pelo usuário', () => {
  const exigencias = [
    { grupo: 'fiscal_trabalhista', descricao: 'Certidão conjunta RFB/PGFN, certidão de regularidade com o FGTS e CNDT (Anexo V, itens 2.3 a 2.5).' },
    { grupo: 'fiscal_trabalhista', descricao: 'Inscrição no cadastro de contribuintes estadual e/ou municipal compatível com o objeto. O MEI é dispensado.' },
  ];
  const documentos = [
    { id: 1, nome: 'CND Federal', categoria: 'certidao_federal', validade: '2026-12-31' },
    { id: 2, nome: 'CNDT', categoria: 'trabalhista', validade: '2026-12-31' },
    { id: 3, nome: 'Municipal', categoria: 'certidao_municipal', validade: '2026-12-31' },
  ];
  let h = conferirHabilitacao({ exigencias, documentos, dataSessao: '2026-11-18', hoje: '2026-11-06' });
  assert.equal(h.itens[0].situacao, 'falta', 'falta o FGTS');
  assert.deepEqual(h.itens[0].faltam, [{ categoria: 'fgts', situacao: 'falta' }]);
  assert.equal(h.itens[1].situacao, 'ok', 'e/ou: basta uma');
  assert.match(resumoHabilitacao({ lido: true, ...h }), /falta: Regularidade do FGTS/);
  h = conferirHabilitacao({ exigencias, documentos, dataSessao: '2026-11-18', hoje: '2026-11-06', ajustes: new Map([[exigencias[0].descricao, 'ok']]) });
  assert.deepEqual([h.itens[0].situacao, h.itens[0].situacaoCalculada, h.apto], ['manual', 'falta', true]);
});
