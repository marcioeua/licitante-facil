// Proposta de preços pronta para anexar no portal (texto em Markdown → Word).
const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze',
  'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CEM[c]);
  if (r < 20) { if (r) partes.push(UNID[r]); } else {
    partes.push(DEZ[Math.floor(r / 10)] + (r % 10 ? ` e ${UNID[r % 10]}` : ''));
  }
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const escalas = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const grupos = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    const nome = i === 0 ? '' : g === 1 ? escalas[i][0] : escalas[i][1];
    partes.push({ txt: i === 1 && g === 1 ? 'mil' : `${ate999(g)}${nome ? ` ${nome}` : ''}`, g, i });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou é centena redonda (ex.: mil e duzentos).
  return partes.map((p, k) => (k > 0 && k === partes.length - 1 && (p.g < 100 || p.g % 100 === 0) ? `e ${p.txt}` : p.txt)).join(' ').replace(/ +/g, ' ');
}

/** Valor em reais por extenso: 1234.5 -> "mil duzentos e trinta e quatro reais e cinquenta centavos". */
export function reaisPorExtenso(valor) {
  const centavosTotal = Math.round(Number(valor) * 100);
  const reais = Math.floor(centavosTotal / 100);
  const cent = centavosTotal % 100;
  const partes = [];
  if (reais) {
    const milhoesRedondos = reais >= 1e6 && reais % 1e6 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${milhoesRedondos ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero reais';
}

const brl = (v, casas = 2) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: casas });
const cnpjFmt = (c) => String(c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

/** Preço do item na proposta: ajustada = último lance; inicial = lance inicial (ou estimado). */
export function precoDoItem(i, tipo) {
  if (tipo === 'ajustada') return i.meu_lance ?? null;
  return i.lance_inicial ?? null;
}

export function montarProposta({ negocio, itens, empresa, tipo = 'inicial', validadeDias = 60, prazoEntrega, pagamento, cidade, hoje = new Date() }) {
  const linhas = itens.map((i, k) => {
    const unit = precoDoItem(i, tipo);
    const total = unit != null && i.quantidade ? unit * i.quantidade : null;
    return { n: i.numero_item ?? k + 1, desc: i.descricao.replace(/\s+/g, ' ').trim(), marca: i.marca || '[MARCA/MODELO]', un: i.unidade || 'un.', qtd: i.quantidade, unit, total };
  });
  const totalGeral = linhas.reduce((s, l) => s + (l.total ?? 0), 0);
  const faltaPreco = linhas.filter((l) => l.unit == null).length;
  const data = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const esc = (t) => String(t ?? '').replace(/\|/g, '/');
  const md = [
    `## ${tipo === 'ajustada' ? 'PROPOSTA DE PREÇOS AJUSTADA' : 'PROPOSTA DE PREÇOS'}`,
    '',
    `**Ao(À) ${negocio.orgao_nome ?? '[ÓRGÃO]'}${negocio.unidade_nome && negocio.unidade_nome !== negocio.orgao_nome ? ` — ${negocio.unidade_nome}` : ''}**`,
    `**${negocio.modalidade ?? 'Licitação'}${negocio.numero_compra ? ` nº ${negocio.numero_compra}/${negocio.ano_compra}` : ''}**`,
    negocio.objeto ? `**Objeto:** ${negocio.objeto}` : null,
    '',
    '### DADOS DA EMPRESA',
    '',
    `- **Razão social:** ${empresa.razao_social ?? '[RAZÃO SOCIAL]'}`,
    `- **CNPJ:** ${empresa.cnpj ? cnpjFmt(empresa.cnpj) : '[CNPJ]'}`,
    `- **Endereço:** ${empresa.endereco || '[ENDEREÇO COMPLETO]'}`,
    `- **Telefone:** ${empresa.telefone || '[TELEFONE]'} · **E-mail:** ${empresa.email || '[E-MAIL]'}`,
    `- **Dados bancários:** ${empresa.banco || '[BANCO, AGÊNCIA E CONTA]'}`,
    `- **Representante legal:** ${empresa.representante || '[NOME]'}${empresa.representante_cargo ? `, ${empresa.representante_cargo}` : ''}${empresa.representante_cpf ? `, CPF ${empresa.representante_cpf}` : ''}`,
    '',
    '### ITENS',
    '',
    '| Item | Descrição | Marca/Modelo | Unid. | Qtd. | Valor unit. | Valor total |',
    '|---|---|---|---|---|---|---|',
    ...linhas.map((l) => `| ${l.n} | ${esc(l.desc)} | ${esc(l.marca)} | ${esc(l.un)} | ${l.qtd != null ? Number(l.qtd).toLocaleString('pt-BR') : '-'} | ${l.unit != null ? brl(l.unit, 4) : '[PREÇO]'} | ${l.total != null ? brl(l.total) : '[TOTAL]'} |`),
    '',
    faltaPreco ? `**Valor global da proposta:** [CONFERIR: ${faltaPreco} item(ns) sem preço]` : `**Valor global da proposta:** ${brl(totalGeral)} (${reaisPorExtenso(totalGeral)}).`,
    '',
    '### CONDIÇÕES',
    '',
    `1. **Validade da proposta:** ${validadeDias} (${inteiroPorExtenso(Number(validadeDias))}) dias, contados da data da sessão pública.`,
    `2. **Prazo de entrega/execução:** ${prazoEntrega || 'conforme o edital e o termo de referência'}.`,
    `3. **Condições de pagamento:** ${pagamento || 'conforme o edital'}.`,
    '4. Nos preços propostos estão incluídos todos os custos e despesas, como tributos, encargos sociais e trabalhistas, frete, seguros e demais despesas necessárias ao cumprimento integral do objeto.',
    '5. Declaramos que o objeto ofertado atende a todas as especificações exigidas no edital e no termo de referência.',
    '',
    `${cidade || '[CIDADE/UF]'}, ${data}.`,
    '',
    '',
    '______________________________________',
    `**${empresa.representante || '[NOME DO REPRESENTANTE]'}**`,
    `${empresa.representante_cargo || '[CARGO]'} — ${empresa.razao_social ?? '[RAZÃO SOCIAL]'}`,
  ].filter((l) => l !== null);
  return { markdown: md.join('\n'), totalGeral, faltaPreco };
}
