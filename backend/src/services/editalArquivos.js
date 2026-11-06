// Baixa os arquivos de uma contratação no PNCP e os converte em partes legíveis pela IA:
// PDFs (inclusive dentro de ZIP) e textos extraídos de Word (.docx/.odt).
import { unzipSync, strFromU8 } from 'fflate';
import { inflateSync } from 'node:zlib';
import { config } from '../config.js';

const MAX_DOWNLOAD = 60 * 1024 * 1024; // por arquivo
const MAX_PDF = 30 * 1024 * 1024; // por PDF enviado à IA
export const MAX_PAGINAS = 550; // a API aceita até 600 páginas por requisição
export const MAX_PARTES = 8;

// Ordem de leitura: edital primeiro, depois termo de referência, depois o resto.
const PRIORIDADE = { 2: 0, 4: 1 };

const ehPdf = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const ehZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * Conta páginas de um PDF de forma aproximada (0 = não foi possível contar).
 * Procura objetos /Type /Page no arquivo e também dentro de object streams compactados.
 */
export function contarPaginas(buf) {
  const re = /\/Type\s*\/Page(?![a-zA-Z])/g;
  const txt = buf.toString('latin1');
  let total = (txt.match(re) ?? []).length;
  // PDFs modernos guardam os objetos de página em /ObjStm compactados com Flate.
  const objStm = /\/Type\s*\/ObjStm[^]*?stream\r?\n/g;
  let m;
  while ((m = objStm.exec(txt))) {
    const inicio = m.index + m[0].length;
    const fim = txt.indexOf('endstream', inicio);
    if (fim < 0) break;
    try {
      total += (inflateSync(buf.subarray(inicio, fim)).toString('latin1').match(re) ?? []).length;
    } catch { /* stream não-Flate ou corrompido: ignora */ }
    objStm.lastIndex = fim;
  }
  return total;
}

function decodificarXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Extrai o texto de um .docx (word/document.xml) ou .odt (content.xml). */
export function textoDeDocumentoOffice(arquivos) {
  const xml = arquivos['word/document.xml'] ?? arquivos['content.xml'];
  if (!xml) return null;
  const s = strFromU8(xml)
    .replace(/<w:tab\/>|<text:tab\/>/g, '\t')
    .replace(/<\/w:p>|<\/text:p>|<\/text:h>|<w:br\/>|<text:line-break\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodificarXml(s).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converte um arquivo baixado em partes: [{nome, tipo:'pdf', bytes, paginas} | {nome, tipo:'texto', texto}]
 * e devolve também os itens ignorados com o motivo.
 */
export function expandirArquivo(nome, buf, profundidade = 0) {
  const partes = [];
  const ignorados = [];
  if (ehPdf(buf)) {
    if (buf.length > MAX_PDF) ignorados.push({ nome, motivo: 'PDF maior que 30 MB' });
    else partes.push({ nome, tipo: 'pdf', bytes: buf, paginas: contarPaginas(buf) });
    return { partes, ignorados };
  }
  if (ehZip(buf)) {
    let conteudo;
    try {
      conteudo = unzipSync(new Uint8Array(buf), { filter: (f) => f.originalSize <= MAX_DOWNLOAD });
    } catch {
      ignorados.push({ nome, motivo: 'arquivo compactado corrompido ou protegido' });
      return { partes, ignorados };
    }
    const texto = textoDeDocumentoOffice(conteudo);
    if (texto !== null) {
      if (texto.length > 20) partes.push({ nome, tipo: 'texto', texto });
      else ignorados.push({ nome, motivo: 'documento sem texto' });
      return { partes, ignorados };
    }
    if (profundidade >= 2) {
      ignorados.push({ nome, motivo: 'ZIP dentro de ZIP em muitos níveis' });
      return { partes, ignorados };
    }
    // O edital principal primeiro; depois os maiores arquivos (anexos costumam ser menores).
    const nomes = Object.keys(conteudo)
      .filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/'))
      .sort((a, b) => (/edital/i.test(b) - /edital/i.test(a)) || conteudo[b].length - conteudo[a].length);
    for (const n of nomes) {
      const r = expandirArquivo(n.split('/').pop(), Buffer.from(conteudo[n]), profundidade + 1);
      partes.push(...r.partes);
      ignorados.push(...r.ignorados);
    }
    return { partes, ignorados };
  }
  const txt = buf.toString('utf8');
  if (/\.(txt|csv)$/i.test(nome) && !txt.includes('\u0000')) {
    partes.push({ nome, tipo: 'texto', texto: txt });
  } else {
    ignorados.push({ nome, motivo: 'formato não suportado (use PDF, Word ou ZIP)' });
  }
  return { partes, ignorados };
}

/** Escolhe as partes que cabem no limite de páginas e de quantidade. */
export function selecionarPartes(partes) {
  const escolhidas = [];
  const ignorados = [];
  let paginas = 0;
  for (const p of partes) {
    const pags = p.tipo === 'pdf' ? p.paginas || 50 : 0; // sem contagem, estima 50
    if (escolhidas.length >= MAX_PARTES) {
      ignorados.push({ nome: p.nome, motivo: 'limite de arquivos por análise' });
    } else if (paginas + pags > MAX_PAGINAS) {
      ignorados.push({ nome: p.nome, motivo: 'limite de páginas por análise' });
    } else {
      escolhidas.push(p);
      paginas += pags;
    }
  }
  return { escolhidas, ignorados };
}

const pncpApi = () => config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');

function nomeDoArquivo(res, fallback) {
  const cd = res?.headers?.get?.('content-disposition') ?? '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : fallback;
}

/** Lista, baixa e expande os arquivos de uma oportunidade no PNCP. */
export async function baixarArquivosEdital(op, { fetchImpl = fetch } = {}) {
  if (!op.orgao_cnpj || !op.ano_compra || !op.sequencial_compra) {
    throw Object.assign(new Error('Esta licitação não tem identificação no PNCP.'), { statusCode: 422 });
  }
  const base = `${pncpApi()}/v1/orgaos/${op.orgao_cnpj}/compras/${op.ano_compra}/${op.sequencial_compra}/arquivos`;
  const res = await fetchImpl(base, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (res.status === 204 || res.status === 404) return { partes: [], ignorados: [] };
  if (!res.ok) throw new Error(`PNCP respondeu ${res.status} ao listar arquivos`);
  const lista = (await res.json())
    .filter((a) => a.statusAtivo !== false && a.url)
    .sort((a, b) => (PRIORIDADE[a.tipoDocumentoId] ?? 9) - (PRIORIDADE[b.tipoDocumentoId] ?? 9)
      || a.sequencialDocumento - b.sequencialDocumento);

  const partes = [];
  const ignorados = [];
  for (const a of lista) {
    const rotulo = a.tipoDocumentoNome || 'Documento';
    const r = await fetchImpl(a.url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) {
      ignorados.push({ nome: `${rotulo} ${a.titulo ?? ''}`.trim(), motivo: `não foi possível baixar (${r.status})` });
      continue;
    }
    const tamanho = Number(r.headers.get('content-length') || 0);
    const nome = `${rotulo} - ${nomeDoArquivo(r, a.titulo ?? `arquivo ${a.sequencialDocumento}`)}`;
    if (tamanho > MAX_DOWNLOAD) {
      ignorados.push({ nome, motivo: 'arquivo maior que 60 MB' });
      r.body?.cancel?.();
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const e = expandirArquivo(nome, buf);
    partes.push(...e.partes);
    ignorados.push(...e.ignorados);
  }
  return { partes, ignorados };
}


/**
 * Primeiro PDF do edital (para enviar ao usuário, ex.: WhatsApp). Baixa só o necessário:
 * o documento "Edital" primeiro; se vier em ZIP, pega o PDF principal de dentro.
 * Devolve { bytes, nome } ou null se não houver PDF.
 */
export async function primeiroPdfDoEdital(op, { fetchImpl = fetch, maxBytes = 60 * 1024 * 1024 } = {}) {
  if (!op.orgao_cnpj || !op.ano_compra || !op.sequencial_compra) return null;
  const res = await fetchImpl(`${pncpApi()}/v1/orgaos/${op.orgao_cnpj}/compras/${op.ano_compra}/${op.sequencial_compra}/arquivos`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) return null;
  const lista = (await res.json()).filter((a) => a.statusAtivo !== false && a.url)
    .sort((a, b) => (PRIORIDADE[a.tipoDocumentoId] ?? 9) - (PRIORIDADE[b.tipoDocumentoId] ?? 9) || a.sequencialDocumento - b.sequencialDocumento)
    .slice(0, 3);
  for (const a of lista) {
    const r = await fetchImpl(a.url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) continue;
    if (Number(r.headers.get('content-length') || 0) > maxBytes) { r.body?.cancel?.(); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const nome = nomeDoArquivo(r, `${a.tipoDocumentoNome || 'Edital'}.pdf`);
    if (ehPdf(buf)) return { bytes: buf, nome: /\.pdf$/i.test(nome) ? nome : `${nome}.pdf` };
    if (ehZip(buf)) {
      const pdf = expandirArquivo(nome, buf).partes.find((p) => p.tipo === 'pdf' && p.bytes?.length <= maxBytes);
      if (pdf) return { bytes: Buffer.from(pdf.bytes), nome: /\.pdf$/i.test(pdf.nome) ? pdf.nome.split('/').pop() : `${pdf.nome}.pdf` };
    }
  }
  return null;
}
