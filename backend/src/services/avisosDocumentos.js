// Aviso de documentos perto de vencer: 30, 15, 7, 3 e 1 dia antes, no dia e logo depois de vencer.
// Vai para o sino, o e-mail e o Telegram (se conectado). Cada documento é avisado uma vez em cada marco.
import { notificar } from './agentes.js';

export const MARCOS = [30, 15, 7, 3, 1, 0, -1]; // -1 = venceu
const fmt = (d) => d.split('-').reverse().join('/');

/** Em que marco o documento está (null = longe de vencer ou vencido há mais de 30 dias). */
export function marcoDoDocumento(validade, hoje) {
  if (!validade) return null;
  const dias = Math.round((new Date(`${validade}T12:00:00Z`) - new Date(`${hoje}T12:00:00Z`)) / 86400000);
  if (dias < -30 || dias > 30) return null;
  if (dias < 0) return { marco: -1, dias };
  return { marco: Math.min(...MARCOS.filter((m) => m >= dias)), dias };
}

function frase(d) {
  if (d.dias < 0) return `❌ ${d.nome}: VENCEU em ${fmt(d.validade)}`;
  if (d.dias === 0) return `⚠️ ${d.nome}: vence HOJE (${fmt(d.validade)})`;
  if (d.dias === 1) return `⚠️ ${d.nome}: vence AMANHÃ (${fmt(d.validade)})`;
  return `📄 ${d.nome}: vence em ${d.dias} dias (${fmt(d.validade)})`;
}

/** Cria os avisos do dia. `hoje` no formato AAAA-MM-DD (horário de Brasília). Devolve quantos usuários foram avisados. */
export function avisarDocumentosVencendo(db, hoje) {
  const docs = db.prepare(`SELECT d.id, d.usuario_id, d.nome, d.validade, e.razao_social AS empresa FROM documentos d
    LEFT JOIN empresas e ON e.id = d.empresa_id WHERE d.validade IS NOT NULL ORDER BY d.validade`).all();
  const ja = db.prepare('SELECT 1 FROM documento_avisos WHERE documento_id = ? AND marco = ?');
  const marcar = db.prepare("INSERT OR IGNORE INTO documento_avisos (documento_id, marco, enviado_em) VALUES (?, ?, datetime('now'))");
  // Negócios ativos com sessão depois do vencimento: o documento precisa ser renovado antes deles.
  const afetados = db.prepare(`SELECT count(*) AS n FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id
    WHERE n.usuario_id = ? AND n.arquivado = 0 AND n.etapa NOT IN ('ganho', 'perdido')
      AND substr(coalesce(n.data_disputa, o.data_encerramento), 1, 10) >= ?`);
  const porUsuario = new Map();
  for (const d of docs) {
    const m = marcoDoDocumento(d.validade, hoje);
    if (!m || ja.get(d.id, m.marco)) continue;
    if (!porUsuario.has(d.usuario_id)) porUsuario.set(d.usuario_id, []);
    porUsuario.get(d.usuario_id).push({ ...d, ...m });
  }
  for (const [uid, lista] of porUsuario) {
    const urgentes = lista.filter((d) => d.dias <= 3).length;
    const titulo = lista.length === 1
      ? (lista[0].dias < 0 ? `Documento vencido: ${lista[0].nome}` : `Documento perto de vencer: ${lista[0].nome}`)
      : `${lista.length} documentos perto de vencer${urgentes ? ` (${urgentes} urgente(s))` : ''}`;
    const negocios = afetados.get(uid, hoje).n;
    const linhas = lista.map((d) => `${frase(d)}${d.empresa ? ` · ${d.empresa}` : ''}`);
    if (negocios) linhas.push(`\nVocê tem ${negocios} negócio(s) ativo(s): renove a tempo para continuar apto a participar.`);
    linhas.push('Depois de renovar, atualize a validade em Documentos.');
    notificar(db, { usuarioId: uid, agente: 'documentos', tipo: 'documento', titulo, mensagem: linhas.join('\n'), link: '/documentos' });
    for (const d of lista) marcar.run(d.id, d.marco);
  }
  return porUsuario.size;
}
