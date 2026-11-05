// Identifica o portal de disputa pelo link do sistema de origem informado ao PNCP.
const PORTAIS = [
  [/cnetmobile|comprasnet|compras\.gov\.br|comprasgovernamentais/i, 'Compras.gov.br'],
  [/portaldecompraspublicas/i, 'Portal de Compras Públicas'],
  [/bllcompras|bll\.org/i, 'BLL Compras'],
  [/licitanet/i, 'Licitanet'],
  [/bnccompras|bnc\.org/i, 'BNC'],
  [/licitacoes-e/i, 'Licitações-e (BB)'],
  [/licitardigital/i, 'Licitar Digital'],
  [/compras\.mg\.gov\.br/i, 'Compras MG'],
  [/pregaobanrisul/i, 'Banrisul'],
  [/compras\.rs\.gov\.br/i, 'Compras RS'],
  [/compras\.rj\.gov\.br/i, 'Compras RJ'],
  [/e-compras\.am\.gov\.br/i, 'Compras AM'],
  [/comprasnet\.ba|comprasbr/i, 'ComprasBR'],
  [/ammlicita/i, 'AMM Licita'],
  [/siades\.es/i, 'SIGA ES'],
  [/e-lic\.sc|sc\.gov\.br/i, 'e-LIC SC'],
  [/peintegrado/i, 'PE Integrado'],
  [/banpara/i, 'Banpará'],
];

export function portalDoLink(link) {
  if (!link) return null;
  for (const [re, nome] of PORTAIS) if (re.test(link)) return nome;
  try {
    return new URL(String(link).trim()).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
