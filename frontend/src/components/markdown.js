// Markdown simples (títulos, negrito, itálico, listas e parágrafos) para HTML seguro.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

export function markdownParaHtml(md) {
  const linhas = String(md ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  let lista = null;
  let par = [];
  const fecharPar = () => { if (par.length) { out.push(`<p>${par.map(inline).join('<br>')}</p>`); par = []; } };
  const fecharLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  let tabela = null;
  const celulas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const fecharTabela = () => {
    if (!tabela) return;
    const [cab, ...corpo] = tabela;
    out.push(`<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:11pt"><thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
      + `<tbody>${corpo.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    tabela = null;
  };
  for (const l of linhas) {
    if (/^\s*\|.*\|\s*$/.test(l)) {
      fecharPar(); fecharLista();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; // linha separadora |---|
      (tabela ??= []).push(celulas(l));
      continue;
    }
    fecharTabela();
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    const ul = l.match(/^\s*[-*•]\s+(.*)$/);
    const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { fecharPar(); fecharLista(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); }
    else if (ul || ol) {
      fecharPar();
      const tipo = ul ? 'ul' : 'ol';
      if (lista !== tipo) { fecharLista(); out.push(`<${tipo}>`); lista = tipo; }
      out.push(`<li>${inline((ul ?? ol)[1])}</li>`);
    } else if (!l.trim()) { fecharPar(); fecharLista(); }
    else { fecharLista(); par.push(l); }
  }
  fecharPar(); fecharLista(); fecharTabela();
  return out.join('\n');
}

/** Baixa o texto como documento do Word (.doc em HTML, abre no Word e no LibreOffice). */
export function baixarWord(titulo, md) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5}h2,h3,h4{font-size:12pt;text-transform:uppercase}p{text-align:justify}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:4px;vertical-align:top}th{background:#eee}</style></head>
<body>${markdownParaHtml(md)}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // Nome só com letras sem acento: alguns navegadores ignoram nomes com acentos ou travessão.
  const nome = String(titulo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[—–]/g, '-')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80).trim();
  a.download = `${nome || 'peca'}.doc`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
