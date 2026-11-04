// Pagômetro: risco de atraso de pagamento a partir da CAPAG (Capacidade de Pagamento)
// publicada pelo Tesouro Nacional no Tesouro Transparente (dados abertos, sem chave).
import { unzipSync, strFromU8 } from 'fflate';
import { tx } from '../db/index.js';

const CKAN = 'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id=';
export const FONTE_URL = 'https://www.tesourotransparente.gov.br/temas/estados-e-municipios/capacidade-de-pagamento-capag';

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** "34,95%" | "0.3495" | 0.3495 -> 0.3495 (fração); "n.d." -> null */
export function numero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/\d/.test(s)) return null;
  const pct = s.endsWith('%');
  const n = Number(s.replace('%', '').replace(/\./g, (m, i) => (s.includes(',') ? '' : m)).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return pct ? Number((n / 100).toPrecision(12)) : n;
}

const nota = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-D][+]?$/.test(s) ? s : null;
};

// ---------- Leitura de CSV (estados) ----------
export function lerCsvEstados(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const cab = linhas[0].split(';').map(norm);
  const col = (nome) => cab.findIndex((c) => c.startsWith(nome));
  const iUf = col('uf');
  const iCapag = col('classificacao da capag');
  const iIcf = col('qualidade da informacao');
  if (iUf < 0 || iCapag < 0) throw new Error('CSV de estados da CAPAG em formato inesperado');
  return linhas.slice(1).map((l) => {
    const c = l.split(';');
    return {
      tipo: 'estado', codigo: c[iUf].trim().toUpperCase(), nome: c[iUf].trim().toUpperCase(), uf: c[iUf].trim().toUpperCase(),
      capag: nota(c[iCapag]) ?? (c[iCapag]?.trim() || null),
      ind1: numero(c[col('indicador 1')]), nota1: nota(c[col('nota 1')]),
      ind2: numero(c[col('indicador 2')]), nota2: nota(c[col('nota 2')]),
      ind3: numero(c[col('indicador 3')]), nota3: nota(c[col('nota 3')]),
      icf: iIcf >= 0 ? c[iIcf]?.trim() || null : null,
    };
  }).filter((e) => /^[A-Z]{2}$/.test(e.codigo));
}

// ---------- Leitura de XLSX (municípios), sem dependências extras ----------
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function colunaParaIndice(ref) {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Lê as linhas de uma planilha XLSX como arrays de texto. */
export function* linhasXlsx(xml, compartilhadas, limite = Infinity) {
  const reLinha = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const reCel = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  let n = 0;
  while ((m = reLinha.exec(xml)) && n++ < limite) {
    const linha = [];
    let c;
    reCel.lastIndex = 0;
    while ((c = reCel.exec(m[1]))) {
      const [, ref, attrs, corpo = ''] = c;
      let valor = '';
      const v = corpo.match(/<v>([\s\S]*?)<\/v>/);
      if (/t="s"/.test(attrs) && v) valor = compartilhadas[Number(v[1])] ?? '';
      else if (/t="inlineStr"/.test(attrs)) valor = ent((corpo.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
      else if (v) valor = ent(v[1]);
      linha[colunaParaIndice(ref)] = valor;
    }
    yield linha;
  }
}

export function lerXlsxMunicipios(buf) {
  const arquivos = unzipSync(new Uint8Array(buf), {
    filter: (f) => f.name === 'xl/sharedStrings.xml' || f.name === 'xl/workbook.xml'
      || f.name === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) && f.originalSize < 200e6,
  });
  const compartilhadas = arquivos['xl/sharedStrings.xml']
    ? [...strFromU8(arquivos['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => ent((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
    : [];
  // Ordem das abas como no arquivo; usa a primeira que tiver o cabeçalho da CAPAG.
  const wb = strFromU8(arquivos['xl/workbook.xml']);
  const rels = strFromU8(arquivos['xl/_rels/workbook.xml.rels']);
  const abas = [...wb.matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map(([, nome, rid]) => {
    const alvo = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
      ?? rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    return { nome: ent(nome), caminho: alvo ? `xl/${alvo.replace(/^\/?(xl\/)?/, '')}` : null };
  });
  for (const aba of abas) {
    const bytes = aba.caminho && arquivos[aba.caminho];
    if (!bytes) continue;
    const xml = strFromU8(bytes);
    let cab = null;
    const entes = [];
    for (const linha of linhasXlsx(xml, compartilhadas)) {
      if (!cab) {
        const n = linha.map(norm);
        if (n.includes('codigo municipio completo') && n.includes('capag') && n.includes('nota 3')) {
          cab = Object.fromEntries(n.map((c, i) => [c, i]).filter(([c]) => c));
        } else if (entes.length === 0 && linha.length && !n.some((c) => c === 'codigo municipio completo')) {
          continue; // linhas acima do cabeçalho
        }
        continue;
      }
      const g = (c) => linha[cab[c]];
      const codigo = String(g('codigo municipio completo') ?? '').trim();
      if (!/^\d{7}$/.test(codigo)) continue;
      entes.push({
        tipo: 'municipio', codigo, nome: g('nome_municipio') ?? g('nome municipio') ?? '', uf: String(g('uf') ?? '').toUpperCase(),
        capag: nota(g('capag')) ?? (String(g('capag') ?? '').trim() || null),
        ind1: numero(g('indicador 1')), nota1: nota(g('nota 1')),
        ind2: numero(g('indicador 2')), nota2: nota(g('nota 2')),
        ind3: numero(g('indicador 3')), nota3: nota(g('nota 3')),
        icf: g('icf') || null,
      });
    }
    if (entes.length) return { aba: aba.nome, entes };
  }
  throw new Error('Planilha de municípios da CAPAG em formato inesperado');
}

// ---------- Download dos dados abertos ----------
async function recursoMaisRecente(dataset, formato, fetchImpl) {
  const res = await fetchImpl(CKAN + dataset, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Tesouro Transparente respondeu ${res.status}`);
  const { result } = await res.json();
  const recursos = result.resources
    .filter((r) => String(r.format).toUpperCase() === formato)
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
  if (!recursos.length) throw new Error(`Nenhum arquivo ${formato} em ${dataset}`);
  return recursos[0];
}

export async function atualizarCapag(db, { fetchImpl = fetch, log = console.log } = {}) {
  const baixar = async (url) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`Falha ao baixar ${url}: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const recEst = await recursoMaisRecente('capag-estados', 'CSV', fetchImpl);
  const estados = lerCsvEstados((await baixar(recEst.url)).toString('utf8'));
  const recMun = await recursoMaisRecente('capag-municipios', 'XLSX', fetchImpl);
  const { aba, entes: municipios } = lerXlsxMunicipios(await baixar(recMun.url));
  const ins = db.prepare(`
    INSERT INTO capag_entes (tipo, codigo, nome, nome_norm, uf, capag, ind1, nota1, ind2, nota2, ind3, nota3, icf, referencia, atualizado_em)
    VALUES (:tipo, :codigo, :nome, :nome_norm, :uf, :capag, :ind1, :nota1, :ind2, :nota2, :ind3, :nota3, :icf, :referencia, datetime('now'))
    ON CONFLICT(tipo, codigo) DO UPDATE SET nome = excluded.nome, nome_norm = excluded.nome_norm, uf = excluded.uf, capag = excluded.capag,
      ind1 = excluded.ind1, nota1 = excluded.nota1, ind2 = excluded.ind2, nota2 = excluded.nota2, ind3 = excluded.ind3,
      nota3 = excluded.nota3, icf = excluded.icf, referencia = excluded.referencia, atualizado_em = excluded.atualizado_em`);
  tx(db, () => {
    for (const e of estados) {
      const nome = NOMES_UF[e.uf] ?? e.uf;
      ins.run({ ...e, nome, nome_norm: norm(nome), referencia: recEst.name ?? 'CAPAG Estados' });
    }
    for (const e of municipios) ins.run({ ...e, nome_norm: norm(e.nome), referencia: `${(recMun.name ?? 'CAPAG Municípios').trim()} (${aba})` });
  });
  log(`CAPAG atualizada: ${estados.length} estados, ${municipios.length} municípios`);
  return { estados: estados.length, municipios: municipios.length };
}

// ---------- Pagômetro ----------
const NOMES_UF = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** Classifica o risco de atraso a partir da CAPAG e da nota de liquidez (indicador 3). */
export function nivelRisco(e) {
  if (!e?.capag || !/^[A-D]/.test(e.capag)) return 'indisponivel';
  const letra = e.capag[0];
  if (letra === 'C' || letra === 'D' || e.nota3 === 'C') return 'alto';
  if ((letra === 'A' || e.capag === 'B+') && (e.nota3 === 'A' || e.nota3 == null)) return 'baixo';
  return 'medio';
}

const TEXTOS = {
  baixo: 'Tende a pagar em dia: boa nota de capacidade de pagamento e caixa suficiente para as contas de curto prazo.',
  medio: 'Atenção: situação fiscal intermediária. Pode haver atrasos pontuais; confira as condições de pagamento do edital.',
  alto: 'Risco de atraso: nota baixa de capacidade de pagamento ou caixa insuficiente para as obrigações de curto prazo.',
  indisponivel: 'O Tesouro Nacional não publicou nota de capacidade de pagamento para este ente.',
};

function apresentar(e, extra = {}) {
  const nivel = nivelRisco(e);
  return {
    nivel,
    texto: TEXTOS[nivel],
    ente: { tipo: e.tipo, nome: e.tipo === 'estado' ? (e.uf === 'DF' ? 'Distrito Federal' : `Estado: ${NOMES_UF[e.uf] ?? e.uf}`) : `${e.nome}/${e.uf}`, uf: e.uf, codigo: e.codigo },
    capag: e.capag,
    indicadores: [
      { nome: 'Endividamento', nota: e.nota1, valor: e.ind1, ajuda: 'Dívida em relação à receita' },
      { nome: 'Poupança corrente', nota: e.nota2, valor: e.ind2, ajuda: 'Quanto da receita já está comprometido com despesas correntes' },
      { nome: 'Liquidez', nota: e.nota3, valor: e.ind3, ajuda: 'Se o caixa cobre as contas a pagar de curto prazo' },
    ],
    qualidadeInformacao: e.icf,
    informacaoFragil: /^C/i.test(e.icf ?? ''),
    referencia: e.referencia,
    fonte: FONTE_URL,
    ...extra,
  };
}

/** Pagômetro de uma oportunidade (licitação). */
export function pagometroDaOportunidade(db, op) {
  const esfera = op.esfera;
  if (esfera === 'F') {
    return {
      nivel: 'federal',
      texto: 'Órgão federal: os pagamentos saem pelo Tesouro Nacional (SIAFI). A União não recebe nota CAPAG; atrasos costumam ser pontuais, ligados a limites de orçamento.',
      ente: { tipo: 'uniao', nome: 'Governo Federal' },
      fonte: FONTE_URL,
    };
  }
  let e = null;
  if (esfera === 'M' && op.codigo_ibge) {
    e = db.prepare("SELECT * FROM capag_entes WHERE tipo = 'municipio' AND codigo = ?").get(String(op.codigo_ibge));
  }
  if (!e && (esfera === 'E' || esfera === 'D') && op.uf) {
    e = db.prepare("SELECT * FROM capag_entes WHERE tipo = 'estado' AND codigo = ?").get(op.uf);
  }
  if (!e && !esfera && op.uf && op.municipio && /munic|prefeit|camara|c[aâ]mara/i.test(op.orgao_nome ?? '')) {
    // Registros antigos sem esfera: tenta a prefeitura pelo nome da cidade.
    e = db.prepare("SELECT * FROM capag_entes WHERE tipo = 'municipio' AND uf = ? AND nome_norm = ?").get(op.uf, norm(op.municipio));
  }
  if (!e && !esfera) {
    return {
      nivel: 'indisponivel',
      texto: 'Ainda não identificamos se este órgão é municipal, estadual ou federal. A informação aparece após a próxima atualização do PNCP.',
      ente: null,
      fonte: FONTE_URL,
    };
  }
  if (!e) {
    const temDados = db.prepare('SELECT 1 FROM capag_entes LIMIT 1').get();
    return {
      nivel: 'indisponivel',
      texto: temDados ? TEXTOS.indisponivel : 'Os dados de capacidade de pagamento ainda estão sendo carregados.',
      ente: null,
      fonte: FONTE_URL,
    };
  }
  const outroOrgao = esfera === 'M' && !/munic|prefeit/i.test(op.orgao_nome ?? '');
  return apresentar(e, outroOrgao ? { observacao: 'Nota da prefeitura do município. Autarquias, câmaras e consórcios podem ter caixa próprio.' } : {});
}

/** Busca de entes para a página do Pagômetro (ignora acentos). */
export function buscarEntes(db, { q = '', uf = '' } = {}, limite = 20) {
  const termo = norm(q);
  if (termo.length < 2 && !uf) return [];
  const params = { lim: limite, q: `%${termo}%`, ini: `${termo}%` };
  let filtroUf = '';
  if (/^[A-Za-z]{2}$/.test(uf)) {
    filtroUf = 'AND uf = :uf';
    params.uf = uf.toUpperCase();
  }
  return db.prepare(`SELECT * FROM capag_entes WHERE nome_norm LIKE :q ${filtroUf}
    ORDER BY (nome_norm LIKE :ini) DESC, tipo = 'municipio' DESC, nome LIMIT :lim`).all(params)
    .map((e) => apresentar(e));
}
