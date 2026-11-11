// Agente Habilitação: compara os documentos que o edital exige (lidos pela IA) com os documentos
// cadastrados pelo usuário e diz se ele está apto a participar.

// Ordem importa: a primeira regra que bate decide. "CRF" do FGTS vem antes de conselhos profissionais.
const REGRAS = [
  ['declaracao', /\bdeclara[cç][aã]o|\bdeclarar\b|\bdeclare\b/i],
  ['fgts', /fgts|garantia do tempo de servi[cç]o|certificado de regularidade do fgts/i],
  ['trabalhista', /trabalhist|cndt|justi[cç]a do trabalho/i],
  ['falencia', /fal[eê]ncia|recupera[cç][aã]o judicial|concordata/i],
  ['certidao_federal', /receita federal|\bfederal\b|d[ií]vida ativa da uni[aã]o|fazenda (nacional|federal)|tributos federais|pgfn|seguridade social|\binss\b|\buni[aã]o\b/i],
  ['certidao_estadual', /estadua|fazenda estadual|icms|distrital/i],
  ['certidao_municipal', /municipa|\biss\b|fazenda municipal|tributos mobili/i],
  ['cnpj', /\bcnpj\b|cadastro nacional d[ae] pessoa jur[ií]dica|cart[aã]o do cnpj/i],
  ['contrato_social', /contrato social|ato constitutivo|estatuto|requerimento de empres|registro comercial|ccmei|microempreendedor|junta comercial|altera[cç][aã]o contratual/i],
  ['balanco', /balan[cç]o|demonstra[cç](ões|oes|[aã]o) cont[aá]b|[ií]ndices? de liquidez|patrim[oô]nio l[ií]quido|capital social m[ií]nimo|boa situa[cç][aã]o financeira/i],
  ['registro_conselho', /conselho regional|\bcrea\b|\bcau\b|\bcrq\b|\bcrm\b|\bcrn\b|registro profissional|registro no conselho|\banvisa\b|autoriza[cç][aã]o de funcionamento/i],
  ['alvara', /alvar[aá]|licen[cç]a (de funcionamento|sanit|ambiental)|vigil[aâ]ncia sanit/i],
  ['atestado_tecnico', /atestado|capacidade t[eé]cnica|acervo t[eé]cnico|\bcat\b/i],
  ['procuracao', /procura[cç][aã]o|credenciamento do representante/i],
  ['documentos_socios', /\brg\b|\bcpf\b|c[eé]dula de identidade|documento de identifica[cç][aã]o|documentos? pessoa/i],
];

export const NOMES_CATEGORIA = {
  certidao_federal: 'Certidão federal (Receita/PGFN)', certidao_estadual: 'Certidão estadual', certidao_municipal: 'Certidão municipal',
  fgts: 'Regularidade do FGTS (CRF)', trabalhista: 'Certidão trabalhista (CNDT)', contrato_social: 'Contrato social / ato constitutivo',
  balanco: 'Balanço patrimonial', atestado_tecnico: 'Atestado de capacidade técnica', procuracao: 'Procuração',
  falencia: 'Certidão de falência e recuperação judicial', cnpj: 'Cartão CNPJ', alvara: 'Alvará / licença',
  registro_conselho: 'Registro em conselho ou órgão regulador', documentos_socios: 'Documentos dos sócios',
};

export function categoriaDaExigencia(descricao) {
  for (const [cat, re] of REGRAS) if (re.test(String(descricao ?? ''))) return cat;
  return null;
}

// Certidões que costumam vir juntas numa só exigência ("CND federal, FGTS e CNDT").
const CERTIDOES = ['certidao_federal', 'fgts', 'trabalhista', 'certidao_estadual', 'certidao_municipal', 'falencia'];
/**
 * Todas as certidões pedidas numa exigência. `qualquer` = basta uma (ex.: "estadual e/ou municipal").
 */
export function categoriasDaExigencia(descricao) {
  const principal = categoriaDaExigencia(descricao);
  if (!CERTIDOES.includes(principal)) return { categorias: principal ? [principal] : [], qualquer: false };
  const texto = String(descricao ?? '');
  const categorias = REGRAS.filter(([cat, re]) => CERTIDOES.includes(cat) && re.test(texto)).map(([cat]) => cat);
  return { categorias, qualquer: categorias.length > 1 && /\be\/ou\b|\bou\b/i.test(texto) };
}
const PIOR = { falta: 4, vencido: 3, vence: 2, ok: 1 };

/**
 * Situação de cada exigência:
 *  ok = tem documento válido na data da sessão; vence = válido hoje, mas vence antes da sessão;
 *  vencido = só tem documento vencido; falta = não tem; declaracao = feita na hora (no portal ou assinada);
 *  conferir = não foi possível classificar (confira manualmente).
 */
export function conferirHabilitacao({ exigencias, documentos, dataSessao, hoje = new Date().toISOString().slice(0, 10), ajustes = new Map() }) {
  const sessao = dataSessao ? String(dataSessao).slice(0, 10) : hoje;
  const porCategoria = Map.groupBy(documentos, (d) => d.categoria);
  // Situação de uma categoria: prefere o documento que vale por mais tempo (sem validade = não vence).
  const avaliar = (categoria) => {
    const doc = [...(porCategoria.get(categoria) ?? [])].sort((a, b) => (b.validade ?? '9999').localeCompare(a.validade ?? '9999'))[0];
    let situacao = 'falta';
    if (doc) situacao = !doc.validade || doc.validade >= sessao ? 'ok' : doc.validade >= hoje ? 'vence' : 'vencido';
    return { categoria, situacao, doc };
  };
  const itens = exigencias.map((e) => {
    const base = (() => {
      const categoria = categoriaDaExigencia(e.descricao);
      if (categoria === 'declaracao') return { ...e, categoria, situacao: 'declaracao' };
      if (!categoria) return { ...e, categoria: null, situacao: 'conferir' };
      const { categorias, qualquer } = categoriasDaExigencia(e.descricao);
      const partes = categorias.map(avaliar);
      // Exige todas (pior situação manda) ou basta uma ("e/ou": melhor situação manda).
      const escolhida = [...partes].sort((a, b) => (qualquer ? PIOR[a.situacao] - PIOR[b.situacao] : PIOR[b.situacao] - PIOR[a.situacao]))[0];
      const doc = partes.find((x) => x.situacao === 'ok')?.doc ?? escolhida.doc;
      return {
        ...e, categoria, categorias, qualquer, situacao: escolhida.situacao,
        faltam: partes.filter((x) => x.situacao !== 'ok').map((x) => ({ categoria: x.categoria, situacao: x.situacao })),
        documento: doc ? { id: doc.id, nome: doc.nome, validade: doc.validade } : null,
      };
    })();
    // Marcado pelo usuário ("já tenho" ou "não se aplica"): conta como resolvido.
    const ajuste = ajustes.get(e.descricao);
    return ajuste ? { ...base, situacaoCalculada: base.situacao, situacao: 'manual', ajuste } : base;
  });
  const conta = (s) => itens.filter((i) => i.situacao === s).length;
  const pendentes = conta('falta') + conta('vencido') + conta('vence');
  return {
    apto: pendentes === 0 && conta('conferir') === 0,
    pendentes,
    contagem: { ok: conta('ok'), manual: conta('manual'), vence: conta('vence'), vencido: conta('vencido'), falta: conta('falta'), declaracao: conta('declaracao'), conferir: conta('conferir') },
    dataSessao: sessao,
    itens,
  };
}

/** Conferência para um negócio do usuário (precisa do edital lido pela IA). */
export function habilitacaoDoNegocio(db, uid, negocioId) {
  const n = db.prepare(`SELECT n.id, n.empresa_id, n.oportunidade_id, coalesce(n.data_disputa, o.data_encerramento) AS data_sessao
    FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id WHERE n.id = ? AND n.usuario_id = ?`).get(negocioId, uid);
  if (!n) return null;
  const resumo = n.oportunidade_id ? db.prepare('SELECT resumo FROM edital_resumos WHERE oportunidade_id = ?').get(n.oportunidade_id) : null;
  if (!resumo) return { lido: false, oportunidadeId: n.oportunidade_id, empresaId: n.empresa_id };
  const exigencias = (JSON.parse(resumo.resumo).documentos_habilitacao ?? []).map((d) => ({ grupo: d.grupo, descricao: d.descricao }));
  // Documentos da empresa do negócio e os sem empresa (gerais). Sem empresa no negócio: todos.
  const documentos = db.prepare(`SELECT id, nome, categoria, validade FROM documentos WHERE usuario_id = ?
    ${n.empresa_id ? 'AND (empresa_id = ? OR empresa_id IS NULL)' : ''}`).all(...(n.empresa_id ? [uid, n.empresa_id] : [uid]));
  const ajustes = new Map(db.prepare('SELECT descricao, situacao FROM habilitacao_ajustes WHERE negocio_id = ?').all(n.id).map((a) => [a.descricao, a.situacao]));
  return {
    lido: true, oportunidadeId: n.oportunidade_id, empresaId: n.empresa_id, conferidoEm: new Date().toISOString(),
    ...conferirHabilitacao({ exigencias, documentos, dataSessao: n.data_sessao, ajustes }),
  };
}

/** O usuário marca uma exigência como resolvida ('ok' = já tenho, 'nao_se_aplica') ou desfaz (null). */
export function ajustarHabilitacao(db, uid, negocioId, { descricao, situacao }) {
  const n = db.prepare('SELECT id FROM negocios WHERE id = ? AND usuario_id = ?').get(negocioId, uid);
  if (!n) return null;
  if (situacao === 'ok' || situacao === 'nao_se_aplica') {
    db.prepare('INSERT OR REPLACE INTO habilitacao_ajustes (negocio_id, descricao, situacao) VALUES (?, ?, ?)').run(n.id, String(descricao).slice(0, 2000), situacao);
  } else {
    db.prepare('DELETE FROM habilitacao_ajustes WHERE negocio_id = ? AND descricao = ?').run(n.id, String(descricao));
  }
  return habilitacaoDoNegocio(db, uid, negocioId);
}

/** Frase curta para avisos (sino, e-mail e WhatsApp). */
export function resumoHabilitacao(h) {
  if (!h?.lido) return null;
  if (!h.itens.length) return 'A IA não encontrou a lista de documentos de habilitação no edital: confira manualmente.';
  if (h.apto) return `✅ Documentação: você está apto (${h.contagem.ok + (h.contagem.manual ?? 0)} documento(s) em dia${h.contagem.declaracao ? ` + ${h.contagem.declaracao} declaração(ões) para assinar` : ''}).`;
  const partes = [];
  const lista = (s) => h.itens.filter((i) => i.situacao === s).flatMap((i) => (i.faltam?.length ? i.faltam.filter((f) => f.situacao === s).map((f) => f.categoria) : [i.categoria]))
    .map((c) => NOMES_CATEGORIA[c] ?? c);
  if (h.contagem.falta) partes.push(`falta: ${[...new Set(lista('falta'))].join(', ')}`);
  if (h.contagem.vencido) partes.push(`vencido: ${[...new Set(lista('vencido'))].join(', ')}`);
  if (h.contagem.vence) partes.push(`vence antes da sessão: ${[...new Set(lista('vence'))].join(', ')}`);
  if (h.contagem.conferir) partes.push(`${h.contagem.conferir} exigência(s) para conferir`);
  return `⚠️ Documentação: ${partes.join(' · ')}.`;
}
