export const brl = (v) =>
  v == null ? 'Não informado' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const dataHora = (s) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const data = (s) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '—');

export function diasAte(s) {
  if (!s) return null;
  return Math.ceil((new Date(s) - Date.now()) / 86400000);
}

export const cnpj = (c) => String(c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

export const ETAPAS = [
  { valor: 'triagem', nome: 'Triagem', cor: 'grey-7', icone: 'filter_alt' },
  { valor: 'analise', nome: 'Em análise', cor: 'blue-7', icone: 'manage_search' },
  { valor: 'proposta', nome: 'Proposta', cor: 'indigo-7', icone: 'edit_document' },
  { valor: 'disputa', nome: 'Disputa', cor: 'orange-8', icone: 'gavel' },
  { valor: 'ganho', nome: 'Ganho', cor: 'green-7', icone: 'emoji_events' },
  { valor: 'perdido', nome: 'Perdido', cor: 'red-7', icone: 'block' },
];
export const etapa = (v) => ETAPAS.find((e) => e.valor === v) ?? ETAPAS[0];

export const CATEGORIAS_DOC = {
  certidao_federal: 'Certidão federal (CND)',
  certidao_estadual: 'Certidão estadual',
  certidao_municipal: 'Certidão municipal',
  fgts: 'Regularidade FGTS (CRF)',
  trabalhista: 'Certidão trabalhista (CNDT)',
  contrato_social: 'Contrato social',
  balanco: 'Balanço patrimonial',
  atestado_tecnico: 'Atestado de capacidade técnica',
  procuracao: 'Procuração',
  falencia: 'Certidão de falência e recuperação judicial',
  cnpj: 'Cartão CNPJ',
  alvara: 'Alvará / licença',
  registro_conselho: 'Registro em conselho (CREA, CRQ...)',
  documentos_socios: 'Documentos dos sócios',
  outros: 'Outros',
};
