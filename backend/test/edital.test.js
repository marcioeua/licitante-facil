import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';

const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');
const { expandirArquivo, contarPaginas, selecionarPartes } = await import('../src/services/editalArquivos.js');
const { ResumoSchema, extrairResposta } = await import('../src/services/editalIA.js');
const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');

// ---- Arquivos de teste ----
const pdf = (paginas) => Buffer.from(`%PDF-1.4\n${Array.from({ length: paginas }, (_, i) => `${i + 3} 0 obj<</Type /Page>>endobj`).join('\n')}\n%%EOF`);
const docx = Buffer.from(zipSync({
  'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Termo de referência: entrega em 30 dias &amp; garantia de 12 meses.</w:t></w:r></w:p></w:body></w:document>'),
}));
const zip = Buffer.from(zipSync({ 'anexo.pdf': new Uint8Array(pdf(2)), 'EDITAL.pdf': new Uint8Array(pdf(10)), 'planilha.xlsx': strToU8('xx') }));

test('expande PDF, ZIP (edital primeiro) e Word; ignora formatos sem suporte', () => {
  assert.equal(contarPaginas(pdf(7)), 7);
  let r = expandirArquivo('Edital - a.zip', zip);
  assert.deepEqual(r.partes.map((p) => [p.nome, p.paginas]), [['EDITAL.pdf', 10], ['anexo.pdf', 2]]);
  assert.equal(r.ignorados[0].nome, 'planilha.xlsx');
  r = expandirArquivo('Termo.docx', docx);
  assert.equal(r.partes[0].tipo, 'texto');
  assert.match(r.partes[0].texto, /entrega em 30 dias & garantia/);
  r = expandirArquivo('foto.jpg', Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(r.partes.length, 0);
});

test('respeita limite de páginas', () => {
  const { escolhidas, ignorados } = selecionarPartes([
    { nome: 'a', tipo: 'pdf', paginas: 400 }, { nome: 'b', tipo: 'pdf', paginas: 300 }, { nome: 'c', tipo: 'texto' },
  ]);
  assert.deepEqual(escolhidas.map((p) => p.nome), ['a', 'c']);
  assert.equal(ignorados[0].motivo, 'limite de páginas por análise');
});

test('schema do resumo é aceito pelo helper de saída estruturada', () => {
  const f = betaZodOutputFormat(ResumoSchema);
  assert.equal(f.type, 'json_schema');
});

test('citações viram números e lista de trechos com página', () => {
  const r = extrairResposta([
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'A entrega é em 30 dias', citations: [{ type: 'page_location', document_index: 0, document_title: 'Edital', cited_text: 'prazo de entrega de 30 dias', start_page_number: 12, end_page_number: 13 }] },
    { type: 'text', text: '.' },
  ]);
  assert.equal(r.texto, 'A entrega é em 30 dias [1].');
  assert.deepEqual(r.citacoes[0], { documento: 'Edital', pagina: 'p. 12', trecho: 'prazo de entrega de 30 dias' });
});

// ---- API com PNCP e Claude simulados ----
let db, app, cookie, opId;
const chamadas = { uploads: [], parse: [], create: [], pncp: 0 };

const fakePncp = async (url) => {
  chamadas.pncp++;
  const u = String(url);
  const headers = (nome) => new Headers({ 'content-disposition': `attachment; filename="${nome}"` });
  if (u.endsWith('/arquivos')) {
    return Response.json([
      { url: 'https://pncp.test/arq/2', tipoDocumentoId: 4, tipoDocumentoNome: 'Termo de Referência', sequencialDocumento: 2, titulo: 'tr', statusAtivo: true },
      { url: 'https://pncp.test/arq/1', tipoDocumentoId: 2, tipoDocumentoNome: 'Edital', sequencialDocumento: 1, titulo: 'ed', statusAtivo: true },
    ]);
  }
  if (u.endsWith('/arq/1')) return new Response(zip, { headers: headers('edital.zip') });
  if (u.endsWith('/arq/2')) return new Response(docx, { headers: headers('tr.docx') });
  return new Response(null, { status: 404 });
};

const resumoFake = {
  objeto: 'Aquisição de mobiliário escolar', resumo: 'Registro de preços para mesas e cadeiras.', orgao: 'Prefeitura Teste',
  modalidade: 'Pregão eletrônico', criterio_julgamento: 'Menor preço por item', modo_disputa: 'Aberto', data_sessao: '20/11/2026 09:00',
  local_disputa: 'Compras.gov.br', prazo_impugnacao: null, valor_estimado: 'R$ 100.000,00', exclusivo_me_epp: 'Sim, itens 1 a 3',
  itens_principais: [{ descricao: 'Cadeira escolar', quantidade: '500', valor_estimado: null }],
  documentos_habilitacao: [{ grupo: 'fiscal_trabalhista', descricao: 'CND federal' }], requisitos_proposta: ['Catálogo'],
  prazo_entrega_execucao: '30 dias', condicoes_pagamento: '30 dias após aceite', garantias: null, vigencia: '12 meses',
  penalidades: null, pontos_atencao: ['Amostra em 3 dias úteis'],
};

const fakeIA = {
  files: { upload: async ({ file, expires_in_seconds }) => { chamadas.uploads.push({ nome: file.name, tipo: file.type, expires_in_seconds }); return { id: `file_${chamadas.uploads.length}` }; } },
  beta: {
    messages: {
      parse: async (req) => { chamadas.parse.push(req); return { model: req.model, stop_reason: 'end_turn', parsed_output: resumoFake, content: [], usage: { input_tokens: 10, output_tokens: 5 } }; },
      create: async (req) => {
        chamadas.create.push(req);
        return {
          model: req.model, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 9 },
          content: [{ type: 'text', text: 'Sim, exige amostra', citations: [{ type: 'page_location', document_index: 0, document_title: 'Edital - EDITAL.pdf', cited_text: 'amostra em 3 dias', start_page_number: 4, end_page_number: 5 }] }],
        };
      },
    },
  },
};

before(async () => {
  db = openDatabase(':memory:');
  app = await buildApp({ db, serveFrontend: false, ia: fakeIA, fetchImpl: fakePncp });
  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  const base = { modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico', anoCompra: 2026, srp: false, dataPublicacaoPncp: f(-1), dataEncerramentoProposta: f(5), valorTotalEstimado: 1000 };
  upsertOportunidades(db, [
    { ...base, numeroControlePNCP: 'A', objetoCompra: 'Mobiliário escolar', sequencialCompra: 1, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'P1' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'São Paulo' } },
    { ...base, numeroControlePNCP: 'B', objetoCompra: 'Mobiliário de escritório', sequencialCompra: 2, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'P2' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' } },
    { ...base, numeroControlePNCP: 'C', objetoCompra: 'Limpeza', sequencialCompra: 3, orgaoEntidade: { cnpj: '11222333000181', razaoSocial: 'P3' }, unidadeOrgao: { ufSigla: 'RS', municipioNome: 'São Paulo das Missões' } },
  ].map(mapContratacao));
  opId = db.prepare("SELECT id FROM oportunidades WHERE numero_controle_pncp = 'A'").get().id;
  const r = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 't@e.com', senha: 'senha-segura-1' } });
  cookie = r.headers['set-cookie'].split(';')[0];
});

const req = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie } });

test('filtro por cidade e sugestões sem acento', async () => {
  let r = await req('GET', '/api/oportunidades/municipios?q=sao%20paulo');
  assert.deepEqual(r.json().map((m) => m.valor), ['SP:São Paulo', 'RS:São Paulo das Missões']);
  r = await req('GET', '/api/oportunidades?municipio=SP:São%20Paulo');
  assert.deepEqual(r.json().itens.map((i) => i.numero_controle_pncp), ['A']);
  r = await req('GET', '/api/oportunidades?municipio=SP:campinas,RS:São%20Paulo%20das%20Missões');
  assert.equal(r.json().total, 2);
  r = await req('POST', '/api/alertas', { nome: 'Móveis', palavras: 'mobiliário', municipios: ['SP:Campinas'] });
  assert.equal(r.statusCode, 201);
  assert.deepEqual(r.json().municipios, ['SP:Campinas']);
  r = await req('GET', `/api/alertas/${r.json().id}/resultados`);
  assert.deepEqual(r.json().itens.map((i) => i.numero_controle_pncp), ['B']);
});

test('resumo do edital: baixa, envia à Files API e chama o Claude com saída estruturada', async () => {
  let r = await req('GET', `/api/oportunidades/${opId}/edital`);
  assert.equal(r.json().iaDisponivel, true);
  assert.equal(r.json().resumo, null);

  r = await req('POST', `/api/oportunidades/${opId}/edital/resumo`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().resumo.objeto, 'Aquisição de mobiliário escolar');
  // Edital (ZIP com 2 PDFs, edital primeiro) + termo de referência em Word como texto.
  assert.deepEqual(chamadas.uploads.map((u) => [u.nome, u.tipo]), [
    ['EDITAL.pdf', 'application/pdf'], ['anexo.pdf', 'application/pdf'], ['Termo de Referência - tr.docx.txt', 'text/plain'],
  ]);
  assert.equal(r.json().ignorados[0].nome, 'planilha.xlsx');

  const p = chamadas.parse[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.format.type, 'json_schema');
  const docs = p.messages[0].content.filter((b) => b.type === 'document');
  assert.equal(docs.length, 3);
  assert.deepEqual(docs[0].source, { type: 'file', file_id: 'file_1' });
  assert.ok(docs[2].cache_control && !docs[0].cache_control, 'cache no último documento');

  // Segunda chamada usa o resumo salvo, sem nova chamada à IA nem novo download.
  const pncpAntes = chamadas.pncp;
  r = await req('POST', `/api/oportunidades/${opId}/edital/resumo`);
  assert.equal(chamadas.parse.length, 1);
  assert.equal(chamadas.pncp, pncpAntes);
});

test('perguntas: reaproveita arquivos, manda histórico e devolve citações', async () => {
  let r = await req('POST', `/api/oportunidades/${opId}/edital/perguntas`, { pergunta: 'Precisa de amostra?' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().resposta, 'Sim, exige amostra [1]');
  assert.deepEqual(r.json().citacoes, [{ documento: 'Edital - EDITAL.pdf', pagina: 'p. 4', trecho: 'amostra em 3 dias' }]);
  assert.equal(chamadas.uploads.length, 3, 'não reenvia arquivos');

  r = await req('POST', `/api/oportunidades/${opId}/edital/perguntas`, { pergunta: 'E o prazo?' });
  const c = chamadas.create[1];
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(c.messages[2].content, 'E o prazo?');
  assert.ok(c.messages[0].content.filter((b) => b.type === 'document').every((d) => d.citations.enabled));
  assert.deepEqual(c.cache_control, { type: 'ephemeral' });

  r = await req('GET', `/api/oportunidades/${opId}/edital`);
  assert.equal(r.json().perguntas.length, 2);
  assert.equal(r.json().resumo.orgao, 'Prefeitura Teste');
});

test('limite diário e IA não configurada', async () => {
  db.prepare("INSERT INTO ia_uso (usuario_id, tipo) SELECT 1, 'pergunta' FROM (SELECT 1 UNION ALL SELECT 2) LIMIT 1").run();
  for (let i = 0; i < 40; i++) db.prepare("INSERT INTO ia_uso (usuario_id, tipo) VALUES (1, 'x')").run();
  let r = await req('POST', `/api/oportunidades/${opId}/edital/perguntas`, { pergunta: 'Mais uma?' });
  assert.equal(r.statusCode, 429);

  const semIA = await buildApp({ db, serveFrontend: false, ia: null, fetchImpl: fakePncp });
  const outro = db.prepare("SELECT id FROM oportunidades WHERE numero_controle_pncp = 'B'").get().id;
  r = await semIA.inject({ method: 'POST', url: `/api/oportunidades/${outro}/edital/resumo`, headers: { cookie } });
  assert.equal(r.statusCode, 503);
});

test('falha do PNCP vira mensagem clara', async () => {
  const quebrado = async () => { throw new TypeError('fetch failed'); };
  const app2 = await buildApp({ db, serveFrontend: false, ia: fakeIA, fetchImpl: quebrado });
  db.prepare('DELETE FROM ia_uso').run();
  const outro = db.prepare("SELECT id FROM oportunidades WHERE numero_controle_pncp = 'C'").get().id;
  const r = await app2.inject({ method: 'POST', url: `/api/oportunidades/${outro}/edital/resumo`, headers: { cookie } });
  assert.equal(r.statusCode, 502);
  assert.match(r.json().erro, /baixar o edital do PNCP/);
});
