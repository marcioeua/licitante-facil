import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';

const { openDatabase } = await import('../src/db/index.js');
const { buildApp } = await import('../src/app.js');
const { lerCsvEstados, lerXlsxMunicipios, numero, nivelRisco, atualizarCapag, pagometroDaOportunidade } = await import('../src/services/capag.js');
const { capagPendente } = await import('../src/jobs/agendador.js');
const { upsertOportunidades, mapContratacao } = await import('../src/services/pncp.js');

const CSV = 'UF;Indicador 1;Nota 1;Indicador 2;Nota 2;Indicador 3;Nota 3;Classificação da CAPAG;Qualidade da informação contábil e fiscal;Observação\r\n'
  + 'SP;147,35%;C;89,75%;B;1,97%;B;B;Bicf;\r\nCE;52,13%;A;90,67%;B;6,87%;A;A+;Aicf;\r\n';

// XLSX mínimo no formato da planilha do Tesouro: título, linha em branco e cabeçalho na linha 3.
function xlsx(linhas) {
  const ss = [];
  const idx = (t) => (ss.includes(t) ? ss.indexOf(t) : ss.push(t) - 1);
  const col = (i) => String.fromCharCode(65 + i);
  const rows = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, i) => (v === '' ? '' : typeof v === 'number'
    ? `<c r="${col(i)}${r + 1}"><v>${v}</v></c>`
    : `<c r="${col(i)}${r + 1}" t="s"><v>${idx(v)}</v></c>`)).join('')}</row>`).join('');
  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Outra" sheetId="1" r:id="rId2"/><sheet name="Prévia da CAPAG" sheetId="2" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${ss.map((t) => `<si><t>${t.replace(/&/g, '&amp;').replace(/'/g, '&apos;')}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'),
  }));
}
const CAB = ['Código Município Completo', 'Nome_Município', 'UF', 'CAPAG', 'Indicador 1', 'Nota 1', 'Indicador 2', 'Nota 2', 'Indicador 3', 'Nota 3', 'ICF'];
const XLSX = xlsx([
  ['Prévia CAPAG'], [], CAB,
  ['3550308', 'São Paulo', 'SP', 'B', 0.374, 'A', 0.942, 'B', 0.0396, 'B', 'Bicf'],
  ['3509502', 'Campinas', 'SP', 'C', 0.17, 'A', 0.92, 'B', -0.0257, 'C', 'Bicf'],
  ['2304400', 'Fortaleza', 'CE', 'A', 0.1, 'A', 0.8, 'A', 0.2, 'A', 'Aicf'],
  ['1100015', "Alta Floresta D'Oeste", 'RO', 'n.d.', '', '', '', '', '', '', 'Cicf'],
]);

test('números no formato brasileiro e do Excel', () => {
  assert.equal(numero('34,95%'), 0.3495);
  assert.equal(numero('4.4333864612702376E-2'), 0.044333864612702376);
  assert.equal(numero('1.234,5'), 1234.5);
  assert.equal(numero('n.d.'), null);
});

test('lê CSV de estados e XLSX de municípios', () => {
  const est = lerCsvEstados(CSV);
  assert.deepEqual(est.map((e) => [e.codigo, e.capag, e.nota3, e.ind1]), [['SP', 'B', 'B', 1.4735], ['CE', 'A+', 'A', 0.5213]]);
  const { aba, entes } = lerXlsxMunicipios(XLSX);
  assert.equal(aba, 'Prévia da CAPAG');
  assert.equal(entes.length, 4);
  assert.deepEqual(entes[1], {
    tipo: 'municipio', codigo: '3509502', nome: 'Campinas', uf: 'SP', capag: 'C',
    ind1: 0.17, nota1: 'A', ind2: 0.92, nota2: 'B', ind3: -0.0257, nota3: 'C', icf: 'Bicf',
  });
  assert.equal(entes[3].nome, "Alta Floresta D'Oeste");
});

test('nível de risco', () => {
  assert.equal(nivelRisco({ capag: 'A', nota3: 'A' }), 'baixo');
  assert.equal(nivelRisco({ capag: 'B+', nota3: 'A' }), 'baixo');
  assert.equal(nivelRisco({ capag: 'B', nota3: 'B' }), 'medio');
  assert.equal(nivelRisco({ capag: 'A', nota3: 'C' }), 'alto');
  assert.equal(nivelRisco({ capag: 'D', nota3: 'A' }), 'alto');
  assert.equal(nivelRisco({ capag: 'n.d.' }), 'indisponivel');
});

test('importação, pagômetro por esfera, selo na busca e busca de entes', async () => {
  const db = openDatabase(':memory:');
  assert.equal(capagPendente(db), true);
  const fakeFetch = async (url) => {
    const u = String(url);
    if (u.includes('package_show?id=capag-estados')) return Response.json({ result: { resources: [{ format: 'CSV', created: '2026-03-10', name: 'Capag Estados 2025', url: 'https://t/est.csv' }, { format: 'CSV', created: '2020-01-01', url: 'https://t/velho.csv' }] } });
    if (u.includes('package_show?id=capag-municipios')) return Response.json({ result: { resources: [{ format: 'XLSX', created: '2026-09-15', name: 'Capag Municípios 2026', url: 'https://t/mun.xlsx' }] } });
    if (u.endsWith('est.csv')) return new Response(CSV);
    if (u.endsWith('mun.xlsx')) return new Response(XLSX);
    return new Response(null, { status: 404 });
  };
  const r = await atualizarCapag(db, { fetchImpl: fakeFetch, log: () => {} });
  assert.deepEqual(r, { estados: 2, municipios: 4 });

  const f = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19);
  const base = { modalidadeId: 6, anoCompra: 2026, dataEncerramentoProposta: f(5), dataPublicacaoPncp: f(-1) };
  upsertOportunidades(db, [
    { ...base, numeroControlePNCP: 'M1', sequencialCompra: 1, objetoCompra: 'Papel', orgaoEntidade: { cnpj: '1', razaoSocial: 'MUNICIPIO DE CAMPINAS', esferaId: 'M' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas', codigoIbge: '3509502' } },
    { ...base, numeroControlePNCP: 'E1', sequencialCompra: 2, objetoCompra: 'Papel', orgaoEntidade: { cnpj: '2', razaoSocial: 'SECRETARIA DA SAUDE', esferaId: 'E' }, unidadeOrgao: { ufSigla: 'CE', municipioNome: 'Fortaleza', codigoIbge: '2304400' } },
    { ...base, numeroControlePNCP: 'F1', sequencialCompra: 3, objetoCompra: 'Papel', orgaoEntidade: { cnpj: '3', razaoSocial: 'MINISTERIO X', esferaId: 'F' }, unidadeOrgao: { ufSigla: 'DF', municipioNome: 'Brasília', codigoIbge: '5300108' } },
    { ...base, numeroControlePNCP: 'M2', sequencialCompra: 4, objetoCompra: 'Papel', orgaoEntidade: { cnpj: '4', razaoSocial: 'SAAE DE ALTA FLORESTA', esferaId: 'M' }, unidadeOrgao: { ufSigla: 'RO', municipioNome: "Alta Floresta D'Oeste", codigoIbge: '1100015' } },
  ].map(mapContratacao));
  const op = (n) => db.prepare('SELECT * FROM oportunidades WHERE numero_controle_pncp = ?').get(n);

  let p = pagometroDaOportunidade(db, op('M1'));
  assert.equal(p.nivel, 'alto');
  assert.equal(p.ente.nome, 'Campinas/SP');
  assert.equal(p.indicadores[2].nota, 'C');
  p = pagometroDaOportunidade(db, op('E1'));
  assert.equal(p.nivel, 'baixo');
  assert.equal(p.ente.nome, 'Estado: Ceará');
  assert.equal(pagometroDaOportunidade(db, op('F1')).nivel, 'federal');
  p = pagometroDaOportunidade(db, op('M2'));
  assert.equal(p.nivel, 'indisponivel');
  assert.match(p.observacao, /prefeitura do município/);

  const app = await buildApp({ db, serveFrontend: false, ia: null });
  const cad = await app.inject({ method: 'POST', url: '/api/auth/cadastro', payload: { nome: 'Teste', email: 'p@e.com', senha: 'senha-segura-1' } });
  const cookie = cad.headers['set-cookie'].split(';')[0];
  const busca = (await app.inject({ method: 'GET', url: '/api/oportunidades?q=papel', headers: { cookie } })).json();
  assert.deepEqual(Object.fromEntries(busca.itens.map((i) => [i.numero_controle_pncp, i.pagometro])), { M1: 'alto', E1: 'baixo', F1: 'federal', M2: 'indisponivel' });
  const det = await app.inject({ method: 'GET', url: `/api/oportunidades/${op('M1').id}/pagometro`, headers: { cookie } });
  assert.equal(det.json().capag, 'C');
  const entes = (await app.inject({ method: 'GET', url: '/api/pagometro?q=sao%20paulo', headers: { cookie } })).json();
  assert.deepEqual(entes.map((e) => e.ente.nome), ['São Paulo/SP', 'Estado: São Paulo']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/pagometro?q=sp' })).statusCode, 401);
});
