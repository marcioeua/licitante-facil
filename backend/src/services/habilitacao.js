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

/**
 * Situação de cada exigência:
 *  ok = tem documento válido na data da sessão; vence = válido hoje, mas vence antes da sessão;
 *  vencido = só tem documento vencido; falta = não tem; declaracao = feita na hora (no portal ou assinada);
 *  conferir = não foi possível classificar (confira manualmente).
 */
export function conferirHabilitacao({ exigencias, documentos, dataSessao, hoje = new Date().toISOString().slice(0, 10) }) {
  const sessao = dataSessao ? String(dataSessao).slice(0, 10) : hoje;
  const porCategoria = Map.groupBy(documentos, (d) => d.categoria);
  const itens = exigencias.map((e) => {
    const categoria = categoriaDaExigencia(e.descricao);
    if (categoria === 'declaracao') return { ...e, categoria, situacao: 'declaracao' };
    if (!categoria) return { ...e, categoria: null, situacao: 'conferir' };
    // Prefere o documento que vale por mais tempo (sem validade = não vence).
    const docs = [...(porCategoria.get(categoria) ?? [])].sort((a, b) => (b.validade ?? '9999').localeCompare(a.validade ?? '9999'));
    const doc = docs[0];
    let situacao = 'falta';
    if (doc) situacao = !doc.validade || doc.validade >= sessao ? 'ok' : doc.validade >= hoje ? 'vence' : 'vencido';
    return { ...e, categoria, situacao, documento: doc ? { id: doc.id, nome: doc.nome, validade: doc.validade } : null };
  });
  const conta = (s) => itens.filter((i) => i.situacao === s).length;
  const pendentes = conta('falta') + conta('vencido') + conta('vence');
  return {
    apto: pendentes === 0 && conta('conferir') === 0,
    pendentes,
    contagem: { ok: conta('ok'), vence: conta('vence'), vencido: conta('vencido'), falta: conta('falta'), declaracao: conta('declaracao'), conferir: conta('conferir') },
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
  return { lido: true, oportunidadeId: n.oportunidade_id, empresaId: n.empresa_id, ...conferirHabilitacao({ exigencias, documentos, dataSessao: n.data_sessao }) };
}

/** Frase curta para avisos (sino, e-mail e WhatsApp). */
export function resumoHabilitacao(h) {
  if (!h?.lido) return null;
  if (!h.itens.length) return 'A IA não encontrou a lista de documentos de habilitação no edital: confira manualmente.';
  if (h.apto) return `✅ Documentação: você está apto (${h.contagem.ok} documento(s) em dia${h.contagem.declaracao ? ` + ${h.contagem.declaracao} declaração(ões) para assinar` : ''}).`;
  const partes = [];
  const lista = (s) => h.itens.filter((i) => i.situacao === s).map((i) => NOMES_CATEGORIA[i.categoria] ?? i.descricao.slice(0, 60));
  if (h.contagem.falta) partes.push(`falta: ${[...new Set(lista('falta'))].join(', ')}`);
  if (h.contagem.vencido) partes.push(`vencido: ${[...new Set(lista('vencido'))].join(', ')}`);
  if (h.contagem.vence) partes.push(`vence antes da sessão: ${[...new Set(lista('vence'))].join(', ')}`);
  if (h.contagem.conferir) partes.push(`${h.contagem.conferir} exigência(s) para conferir`);
  return `⚠️ Documentação: ${partes.join(' · ')}.`;
}
