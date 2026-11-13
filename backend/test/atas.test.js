import { test } from 'node:test';
import assert from 'node:assert/strict';
const { openDatabase } = await import('../src/db/index.js');
const { lerAta, candidatosAta } = await import('../src/services/atas.js');

const C = '04628376000104-1-000049/2026';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\ntrailer\n%%EOF');

test('ata da sessão: acha o melhor documento, lê com IA uma vez e guarda', async () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash) VALUES ('T', 't@e.com', 'x')").run();
  const fake = async (url) => {
    const u = String(url);
    if (u.endsWith('/arquivos')) return Response.json([
      { titulo: 'EDITAL.pdf', tipoDocumentoNome: 'Edital', url: 'https://x/1' },
      { titulo: 'Ata_Parcial_1.zip', tipoDocumentoNome: 'Outros Documentos', url: 'https://x/2' },
      { titulo: 'Ata_Final_1.zip', tipoDocumentoNome: 'Outros Documentos', url: 'https://x/3' },
    ]);
    if (u === 'https://x/3') return new Response(PDF);
    return new Response(null, { status: 404 });
  };
  const cand = await candidatosAta(C, { fetchImpl: fake });
  assert.deepEqual(cand.map((c) => c.titulo), ['Ata_Final_1.zip', 'Ata_Parcial_1.zip'], 'edital fora; final antes da parcial');
  assert.deepEqual(await lerAta(db, 1, C, { fetchImpl: fake, somenteCache: true }), { candidatos: cand });

  let chamadas = 0;
  const client = { beta: { messages: { parse: async (req) => {
    chamadas++;
    assert.equal(req.messages[0].content[0].source.type, 'base64');
    return { model: 'teste', usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn', parsed_output: {
      tem_propostas: true, observacao: null,
      itens: [{ numero: '0001', descricao: 'COLCHÃO', propostas: [
        { fornecedor: 'J S PACHECO LTDA', cnpj: '23.257.853/0001-09', marca: 'ORTOBOM', modelo: 'D28', valor_unitario: 610, valor_total: 122000, classificacao: 1, situacao: 'Arrematante', motivo: null }] }] } };
  } } } };
  const r = await lerAta(db, 1, C, { client, fetchImpl: fake });
  assert.equal(r.arquivo, 'Ata_Final_1.zip');
  assert.equal(r.ata.itens[0].propostas[0].marca, 'ORTOBOM');
  assert.equal(db.prepare("SELECT count(*) AS n FROM ia_uso WHERE tipo = 'ata'").get().n, 1);
  // De novo (outro usuário inclusive): vem do que foi guardado, sem nova leitura.
  const r2 = await lerAta(db, 2, C, { client, fetchImpl: fake, somenteCache: true });
  assert.equal(r2.ata.itens[0].propostas[0].fornecedor, 'J S PACHECO LTDA');
  assert.equal(chamadas, 1);
  // Compra sem ata anexada.
  const semAta = async (url) => (String(url).endsWith('/arquivos') ? Response.json([{ titulo: 'EDITAL', tipoDocumentoNome: 'Edital', url: 'https://x/9' }]) : new Response(null, { status: 404 }));
  assert.deepEqual(await lerAta(db, 1, '11111111000111-1-000001/2026', { client, fetchImpl: semAta }), { semAta: true, candidatos: [] });
});
