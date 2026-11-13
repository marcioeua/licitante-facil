// Custo do uso da IA (Claude) a partir dos tokens registrados em ia_uso.
// Preços oficiais da Anthropic em US$ por milhão de tokens (entrada, saída, leitura de cache).
// Escrita de cache (cache de 5 minutos) custa 1,25 x o preço de entrada.
export const PRECOS = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2 },
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5 },
  'claude-opus-4-8': { entrada: 5, saida: 25, cacheLeitura: 0.5 },
  'claude-fable-5-1': { entrada: 10, saida: 50, cacheLeitura: 0.25 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2 },
};
const PADRAO = 'claude-opus-5-5';
export const COTACAO_PADRAO = Number(process.env.DOLAR_REAL ?? 5.5);

/** Custo em US$ de um registro de uso. */
export function custoUsd(r) {
  const nomeModelo = String(r.modelo ?? PADRAO).replace(/-\d{8}$/, '');
  const p = PRECOS[nomeModelo] ?? PRECOS[PADRAO];
  return ((r.input_tokens ?? 0) * p.entrada + (r.cache_write_tokens ?? 0) * p.entrada * 1.25
    + (r.cache_read_tokens ?? 0) * p.cacheLeitura + (r.output_tokens ?? 0) * p.saida) / 1e6;
}

export function configIA(db, uid) {
  const c = db.prepare('SELECT limite_mensal_usd, cotacao_dolar FROM ia_config WHERE usuario_id = ?').get(uid);
  return { limiteMensalUsd: c?.limite_mensal_usd ?? null, cotacaoDolar: c?.cotacao_dolar ?? COTACAO_PADRAO };
}

export function salvarConfigIA(db, uid, { limiteMensalUsd, cotacaoDolar }) {
  const atual = configIA(db, uid);
  db.prepare(`INSERT INTO ia_config (usuario_id, limite_mensal_usd, cotacao_dolar) VALUES (?, ?, ?)
    ON CONFLICT(usuario_id) DO UPDATE SET limite_mensal_usd = excluded.limite_mensal_usd, cotacao_dolar = excluded.cotacao_dolar`)
    .run(uid, limiteMensalUsd === undefined ? atual.limiteMensalUsd : limiteMensalUsd, cotacaoDolar ?? atual.cotacaoDolar);
  return configIA(db, uid);
}

// Mês corrente no horário de Brasília (ia_uso.criado_em está em UTC).
const inicioDoMesUtc = (db) => db.prepare(
  "SELECT datetime(strftime('%Y-%m-01', datetime('now', '-3 hours')), '+3 hours') AS d").get().d;

export function gastoDoMesUsd(db, uid) {
  return db.prepare('SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, modelo FROM ia_uso WHERE usuario_id = ? AND criado_em >= ?')
    .all(uid, inicioDoMesUtc(db)).reduce((s, r) => s + custoUsd(r), 0);
}

const NOMES_TIPO = {
  resumo: 'Leitura do edital', pergunta: 'Pergunta ao edital', chat_pregoeiro: 'Chat do pregoeiro', juridico_analise: 'Análise jurídica',
  assistente: 'Assistente (chat no sistema)', juridico_esclarecimento: 'Pedido de esclarecimento', juridico_impugnacao: 'Impugnação', juridico_recurso: 'Recurso', juridico_contrarrazoes: 'Contrarrazões',
  ata: 'Leitura da ata (licitantes e marcas)',
};

/** Painel "Uso da IA": hoje, mês, por dia, por tipo e cada uso com o edital/negócio. */
export function painelUso(db, uid, { mes } = {}) {
  const cfg = configIA(db, uid);
  const ym = /^\d{4}-\d{2}$/.test(mes ?? '') ? mes : db.prepare("SELECT strftime('%Y-%m', datetime('now', '-3 hours')) AS m").get().m;
  const linhas = db.prepare(`SELECT u.*, datetime(u.criado_em, '-3 hours') AS quando FROM ia_uso u
    WHERE u.usuario_id = ? AND strftime('%Y-%m', datetime(u.criado_em, '-3 hours')) = ? ORDER BY u.id DESC`).all(uid, ym);
  const titulo = (ref) => {
    const [t, id] = String(ref ?? '').split(':');
    if (t === 'op') {
      const o = db.prepare('SELECT objeto, orgao_nome, municipio, uf FROM oportunidades WHERE id = ?').get(Number(id));
      return o ? { titulo: o.objeto, detalhe: [o.orgao_nome, o.municipio && `${o.municipio}/${o.uf}`].filter(Boolean).join(' · '), link: `/oportunidades/${id}` } : null;
    }
    if (t === 'conv') {
      const c = db.prepare('SELECT titulo FROM assistente_conversas WHERE id = ? AND usuario_id = ?').get(Number(id), uid);
      return c ? { titulo: `Conversa: ${c.titulo}`, detalhe: null, link: `/assistente?c=${id}` } : null;
    }
    if (t === 'neg') {
      const n = db.prepare('SELECT titulo FROM negocios WHERE id = ? AND usuario_id = ?').get(Number(id), uid);
      return n ? { titulo: n.titulo, detalhe: null, link: `/negocios/${id}` } : null;
    }
    return null;
  };
  const itens = linhas.map((r) => ({
    id: r.id, quando: r.quando, tipo: r.tipo, tipoNome: NOMES_TIPO[r.tipo] ?? r.tipo, modelo: r.modelo,
    tokensEntrada: (r.input_tokens ?? 0) + (r.cache_write_tokens ?? 0), tokensCache: r.cache_read_tokens ?? 0, tokensSaida: r.output_tokens ?? 0,
    usd: custoUsd(r), ...(titulo(r.referencia) ?? { titulo: null, detalhe: null, link: null }),
  }));
  const soma = (l) => l.reduce((s, i) => s + i.usd, 0);
  const hoje = db.prepare("SELECT date(datetime('now', '-3 hours')) AS d").get().d;
  const leituras = itens.filter((i) => i.tipo === 'resumo');
  const porDia = [...Map.groupBy(itens, (i) => i.quando.slice(0, 10))].map(([dia, l]) => ({ dia, usd: soma(l), usos: l.length }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  const porTipo = [...Map.groupBy(itens, (i) => i.tipoNome)].map(([nome, l]) => ({ nome, usd: soma(l), usos: l.length })).sort((a, b) => b.usd - a.usd);
  const totalMes = soma(itens);
  return {
    mes: ym, ...cfg,
    hoje: { usd: soma(itens.filter((i) => i.quando.startsWith(hoje))), usos: itens.filter((i) => i.quando.startsWith(hoje)).length },
    totalMes: { usd: totalMes, usos: itens.length },
    mediaPorEdital: leituras.length ? soma(leituras) / leituras.length : null,
    leiturasEdital: leituras.length,
    usoDoLimite: cfg.limiteMensalUsd ? Math.min(1, gastoDoMesUsd(db, uid) / cfg.limiteMensalUsd) : null,
    porDia, porTipo, itens: itens.slice(0, 200),
  };
}
