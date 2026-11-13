// Calculadora de preço para licitações: impostos, DIFAL, margem e preço mínimo.
// Regras oficiais usadas:
// - Simples Nacional: tabelas dos Anexos I (comércio) e III (serviços) da LC 123/2006 (redação da LC 155/2016).
//   Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12.
// - Lucro Presumido: presunção de 8% (comércio) ou 32% (serviços) para IRPJ (15%) e 12%/32% para CSLL (9%);
//   PIS 0,65% e COFINS 3% (cumulativos). Adicional de IRPJ (10%) não incluído.
// - Lucro Real (simplificado): PIS 1,65% e COFINS 7,6% com crédito sobre a compra; IRPJ+CSLL de 34% sobre o lucro.
// - ICMS interestadual (Resoluções do Senado 22/1989 e 13/2012): 7% das regiões Sul/Sudeste (exceto ES) para
//   Norte, Nordeste, Centro-Oeste e ES; 12% nos demais casos; 4% para produto importado.
// - DIFAL em venda a órgão público (não contribuinte do ICMS): devido pelo vendedor (EC 87/2015, LC 190/2022).
//   Pela decisão do STF (ADI 5464), empresas do Simples Nacional não recolhem esse DIFAL.
// - Retenção federal (IN RFB 1.234/2012): 5,85% em vendas de mercadorias para órgãos federais (não vale para o Simples).

export const SIMPLES = {
  I: [[180000, 0.04, 0], [360000, 0.073, 5940], [720000, 0.095, 13860], [1800000, 0.107, 22500], [3600000, 0.143, 87300], [4800000, 0.19, 378000]],
  III: [[180000, 0.06, 0], [360000, 0.112, 9360], [720000, 0.135, 17640], [1800000, 0.16, 35640], [3600000, 0.21, 125640], [4800000, 0.33, 648000]],
};
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const SUL_SUDESTE_SEM_ES = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'];

/** Alíquota efetiva do Simples Nacional para a receita bruta dos últimos 12 meses (RBT12). */
export function aliquotaSimples(anexo, rbt12) {
  const tabela = SIMPLES[anexo] ?? SIMPLES.I;
  const r = Number(rbt12) || 0;
  if (r <= 0) return { efetiva: tabela[0][1], faixa: 1, nominal: tabela[0][1], acimaDoLimite: false };
  const i = tabela.findIndex(([teto]) => r <= teto);
  const k = i === -1 ? tabela.length - 1 : i;
  const [, nominal, deduzir] = tabela[k];
  return { efetiva: Math.max(0, (r * nominal - deduzir) / r), faixa: k + 1, nominal, acimaDoLimite: i === -1 };
}

/** Alíquota interestadual do ICMS (null quando a venda é dentro do mesmo estado). */
export function aliquotaInterestadual(origem, destino, importado = false) {
  if (!origem || !destino || origem === destino) return null;
  if (importado) return 0.04;
  return SUL_SUDESTE_SEM_ES.includes(origem) && !SUL_SUDESTE_SEM_ES.includes(destino) ? 0.07 : 0.12;
}

const fmtPct = (v) => (v * 100).toFixed(1).replace('.0', '').replace('.', ',');
const n = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const pct = (v) => n(v) / 100;

/**
 * Monta os percentuais que incidem sobre o preço e os custos por unidade.
 * e = { regime: 'simples'|'presumido'|'real'|'mei', tipo: 'mercadoria'|'servico', rbt12, custo, frete, outros,
 *       despesasPct, ufOrigem, ufDestino, importado, icmsInternoOrigem, icmsInternoDestino, icmsCreditoCompra,
 *       issPct, difalMetodo: 'unica'|'dupla', difalNoSimples, orgaoFederal }
 */
export function estrutura(e) {
  const mercadoria = e.tipo !== 'servico';
  const linhas = []; // { nome, pct (sobre o preço) } ou { nome, valor (R$ por unidade, negativo = crédito) }
  const avisos = [];
  const custo = n(e.custo);
  const inter = mercadoria ? aliquotaInterestadual(e.ufOrigem, e.ufDestino, e.importado) : null;
  const destinoInterno = pct(e.icmsInternoDestino);
  let ir34 = false;

  if (e.regime === 'mei') {
    avisos.push('MEI paga um valor fixo por mês (DAS), não um percentual por venda; o limite de faturamento é de R$ 81 mil por ano.');
  } else if (e.regime === 'simples') {
    const s = aliquotaSimples(mercadoria ? 'I' : 'III', e.rbt12);
    linhas.push({ nome: `Simples Nacional (Anexo ${mercadoria ? 'I' : 'III'}, faixa ${s.faixa})`, pct: s.efetiva });
    if (!n(e.rbt12)) avisos.push('Sem o faturamento dos últimos 12 meses, usamos a alíquota da 1ª faixa do Simples.');
    if (s.acimaDoLimite) avisos.push('Faturamento acima de R$ 4,8 milhões: a empresa sai do Simples Nacional.');
    else if (n(e.rbt12) > 3600000) avisos.push('Acima de R$ 3,6 milhões o ICMS/ISS é pago fora do DAS (sublimite): confira com seu contador.');
  } else if (e.regime === 'presumido') {
    linhas.push({ nome: `IRPJ (15% sobre ${mercadoria ? '8%' : '32%'} presumido)`, pct: mercadoria ? 0.012 : 0.048 });
    linhas.push({ nome: `CSLL (9% sobre ${mercadoria ? '12%' : '32%'} presumido)`, pct: mercadoria ? 0.0108 : 0.0288 });
    linhas.push({ nome: 'PIS (cumulativo)', pct: 0.0065 });
    linhas.push({ nome: 'COFINS (cumulativo)', pct: 0.03 });
    avisos.push('Adicional de IRPJ (10% sobre o lucro presumido acima de R$ 20 mil por mês) não está incluído.');
  } else if (e.regime === 'real') {
    linhas.push({ nome: 'PIS (não cumulativo)', pct: 0.0165 });
    linhas.push({ nome: 'COFINS (não cumulativo)', pct: 0.076 });
    if (mercadoria && custo) linhas.push({ nome: 'Crédito de PIS/COFINS da compra', valor: -custo * 0.0925 });
    ir34 = true;
    avisos.push('Lucro Real simplificado: IRPJ + CSLL de 34% sobre o lucro da venda; créditos e despesas da empresa toda não entram.');
  }

  // ICMS (mercadoria) e ISS (serviço) fora do Simples e do MEI.
  if (e.regime === 'presumido' || e.regime === 'real') {
    if (mercadoria) {
      const aliqVenda = inter ?? pct(e.icmsInternoOrigem);
      linhas.push({ nome: inter != null ? `ICMS interestadual (${(inter * 100).toFixed(0)}%)` : `ICMS interno (${fmtPct(aliqVenda)}%)`, pct: aliqVenda });
      if (n(e.icmsCreditoCompra) && custo) linhas.push({ nome: 'Crédito de ICMS da compra', valor: -custo * pct(e.icmsCreditoCompra) });
    } else if (n(e.issPct)) {
      linhas.push({ nome: 'ISS', pct: pct(e.issPct) });
    }
  }

  // DIFAL: venda interestadual de mercadoria para órgão público (não contribuinte).
  let difal = null;
  if (mercadoria && inter != null && e.regime !== 'mei') {
    if (!destinoInterno) {
      avisos.push(`Venda para outro estado: informe a alíquota interna de ICMS de ${e.ufDestino} para calcular o DIFAL.`);
    } else if (e.regime === 'simples' && !e.difalNoSimples) {
      avisos.push('DIFAL: pela decisão do STF (ADI 5464), o Simples Nacional não paga DIFAL em venda para consumidor final não contribuinte (como órgãos públicos). Confirme com seu contador.');
    } else if (destinoInterno > inter) {
      const coef = e.difalMetodo === 'dupla'
        ? (destinoInterno * (1 - inter)) / (1 - destinoInterno) - inter // ICMS "por dentro" com a alíquota do destino
        : destinoInterno - inter;
      difal = coef;
      linhas.push({ nome: `DIFAL ${e.ufOrigem}→${e.ufDestino} (${fmtPct(destinoInterno)}% − ${(inter * 100).toFixed(0)}%${e.difalMetodo === 'dupla' ? ', base dupla' : ''})`, pct: coef });
    }
  }
  if (n(e.despesasPct)) linhas.push({ nome: 'Despesas sobre o preço (comissão, taxas, garantia...)', pct: pct(e.despesasPct), despesa: true });
  if (n(e.frete)) linhas.push({ nome: 'Frete por unidade', valor: n(e.frete), despesa: true });
  if (n(e.outros)) linhas.push({ nome: 'Outros custos por unidade (embalagem, seguro...)', valor: n(e.outros), despesa: true });

  const sobrePreco = linhas.filter((l) => l.pct != null).reduce((a, l) => a + l.pct, 0);
  const fixo = custo + linhas.filter((l) => l.valor != null).reduce((a, l) => a + l.valor, 0);
  const retencao = e.orgaoFederal && mercadoria && (e.regime === 'presumido' || e.regime === 'real') ? 0.0585 : 0;
  return { linhas, avisos, sobrePreco, fixo, ir34, inter, difal, retencao };
}

/** Preço que dá a margem líquida pedida (margem = lucro ÷ preço). margem 0 = preço mínimo sem prejuízo. */
export function precoParaMargem(e, margemPct = 0) {
  const s = estrutura(e);
  const m = pct(margemPct);
  const divisor = 1 - s.sobrePreco - (s.ir34 ? m / 0.66 : m);
  if (divisor <= 0) return null;
  return s.fixo / divisor;
}

/** Resultado de vender por um preço: impostos, despesas e lucro por unidade e no total. */
export function analisarPreco(e, preco, quantidade = 1) {
  const s = estrutura(e);
  const p = n(preco);
  const itens = s.linhas.map((l) => ({ ...l, rs: l.pct != null ? p * l.pct : l.valor }));
  let antesIR = p - s.fixo - p * s.sobrePreco;
  let irpjCsll = 0;
  if (s.ir34 && antesIR > 0) {
    irpjCsll = antesIR * 0.34;
    itens.push({ nome: 'IRPJ + CSLL sobre o lucro (34%)', rs: irpjCsll });
  }
  const lucro = antesIR - irpjCsll;
  const impostos = itens.filter((i) => !i.despesa).reduce((a, i) => a + i.rs, 0);
  const q = Math.max(1, n(quantidade) || 1);
  return {
    preco: p, itens, impostos, lucro, margem: p ? lucro / p : 0, markup: n(e.custo) ? p / n(e.custo) : null,
    total: { venda: p * q, lucro: lucro * q, impostos: impostos * q },
    retencao: p * s.retencao, avisos: s.avisos,
  };
}

/** Lances de `de` até `ate` (preço mínimo), com o lucro de cada um. */
export function tabelaDeLances(e, de, ate, passos = 10) {
  const a = n(de);
  const b = n(ate);
  if (!(a > 0) || !(b > 0) || a <= b) return [];
  const passo = (a - b) / passos;
  return Array.from({ length: passos + 1 }, (_, i) => {
    const preco = Math.round((a - passo * i) * 100) / 100;
    const r = analisarPreco(e, preco);
    return { preco, lucro: r.lucro, margem: r.margem };
  });
}
