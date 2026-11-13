// Avisos pelo WhatsApp com a API oficial da Meta (WhatsApp Cloud API).
// Mensagens iniciadas pela empresa precisam de modelos ("templates") aprovados pela Meta:
//  - aviso_busca_pregao (Utilidade): corpo com {{1}} = título e {{2}} = detalhes;
//  - edital_busca_pregao (Utilidade): cabeçalho Documento + corpo com {{1}} = objeto e {{2}} = detalhes.
import { config } from '../config.js';
import { primeiroPdfDoEdital } from './editalArquivos.js';

const env = (k, padrao) => process.env[k] || padrao;
export const MODELOS = {
  aviso: () => env('WHATSAPP_TEMPLATE_AVISO', 'aviso_busca_pregao'),
  edital: () => env('WHATSAPP_TEMPLATE_EDITAL', 'edital_busca_pregao'),
  idioma: () => env('WHATSAPP_TEMPLATE_IDIOMA', 'pt_BR'),
};

/** Número no formato internacional só com dígitos (55 + DDD + número). null se inválido. */
export function normalizarNumero(entrada) {
  const txt = String(entrada ?? '').trim();
  let d = txt.replace(/\D/g, '');
  if (!d) return null;
  if (txt.startsWith('+')) return d.length >= 11 && d.length <= 15 ? d : null;
  d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^55\d{10,11}$/.test(d) ? d : null;
}

/** Parâmetros de modelo não aceitam quebra de linha, tabulação nem mais de 4 espaços seguidos. */
export function limparParametro(t, max = 900) {
  const s = String(t ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').replace(/( · )+/g, ' · ').trim().replace(/^· |· $/g, '');
  return (s.length > max ? `${s.slice(0, max - 1)}…` : s) || '-';
}

export function clienteWhatsApp({ fetchImpl = fetch } = {}) {
  const token = process.env.WHATSAPP_TOKEN;
  const telefoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !telefoneId) return null;
  const base = `https://graph.facebook.com/${env('WHATSAPP_API_VERSION', 'v25.0')}`;
  const chamar = async (caminho, init) => {
    const r = await fetchImpl(`${base}/${caminho}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.error_user_msg || j.error?.message || `WhatsApp respondeu ${r.status}`), { status: r.status, codigo: j.error?.code });
    return j;
  };
  const modelo = (nome, para, parametros, cabecalho) => chamar(`${telefoneId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: para, type: 'template',
      template: {
        name: nome, language: { code: MODELOS.idioma() },
        components: [
          ...(cabecalho ? [{ type: 'header', parameters: [cabecalho] }] : []),
          { type: 'body', parameters: parametros.map((p, i) => ({ type: 'text', text: limparParametro(p, i === 0 ? 200 : 900) })) },
        ],
      },
    }),
  });
  return {
    enviarAviso: (para, titulo, texto) => modelo(MODELOS.aviso(), para, [titulo, texto]),
    async enviarDocumento(para, { bytes, nomeArquivo, titulo, texto }) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'application/pdf');
      form.append('file', new Blob([bytes], { type: 'application/pdf' }), nomeArquivo);
      const midia = await chamar(`${telefoneId}/media`, { method: 'POST', body: form });
      return modelo(MODELOS.edital(), para, [titulo, texto], { type: 'document', document: { id: midia.id, filename: nomeArquivo.slice(0, 120) } });
    },
  };
}

const brl = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataHoraBr = (s) => (s ? new Date(`${String(s).slice(0, 19)}`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null);

export function detalhesDaLicitacao(op, appUrl = config.appUrl) {
  return [
    [op.orgao_nome, op.municipio && op.uf ? `${op.municipio}/${op.uf}` : op.uf].filter(Boolean).join(' - '),
    [op.modalidade, op.numero_compra ? `nº ${op.numero_compra}/${op.ano_compra}` : null].filter(Boolean).join(' '),
    op.valor_estimado ? `Valor estimado: ${brl(op.valor_estimado)}` : 'Valor estimado: não informado',
    op.data_encerramento ? `Propostas até: ${dataHoraBr(op.data_encerramento)}` : null,
    `Ver no sistema: ${appUrl}/#/oportunidades/${op.id}`,
  ].filter(Boolean).join(' · ');
}

/** Dados da licitação + PDF do edital (ou null), para enviar por qualquer canal. */
export async function montarEnvioEdital(db, oportunidadeId, { fetchImpl = fetch, appUrl, semPdf = false } = {}) {
  const op = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(oportunidadeId);
  if (!op) throw Object.assign(new Error('Licitação não encontrada.'), { statusCode: 404 });
  let pdf = null;
  if (!semPdf) { try { pdf = await primeiroPdfDoEdital(op, { fetchImpl }); } catch { pdf = null; } }
  return { op, titulo: op.objeto, texto: detalhesDaLicitacao(op, appUrl), pdf };
}

/** Envia o edital (PDF) de uma licitação; se não houver PDF, manda o aviso com o link do PNCP. */
export async function enviarEdital(db, cliente, uid, oportunidadeId, { fetchImpl = fetch, appUrl } = {}) {
  const u = db.prepare('SELECT whatsapp, whatsapp_ativo FROM usuarios WHERE id = ?').get(uid);
  if (!u?.whatsapp || !u.whatsapp_ativo) throw Object.assign(new Error('Ative o WhatsApp na página Agentes primeiro.'), { statusCode: 400 });
  const { op, titulo, texto, pdf } = await montarEnvioEdital(db, oportunidadeId, { fetchImpl, appUrl });
  if (pdf) {
    await cliente.enviarDocumento(u.whatsapp, { bytes: pdf.bytes, nomeArquivo: pdf.nome, titulo, texto });
    return { documento: true, arquivo: pdf.nome };
  }
  await cliente.enviarAviso(u.whatsapp, `Licitação: ${titulo}`, `${texto} · O edital não está em PDF no PNCP: ${op.link_pncp ?? ''}`);
  return { documento: false };
}

/** Envia os editais da fila (licitações que o Prospector colocou no funil e pedidos manuais pendentes). */
export async function processarFilaWhatsApp(db, { cliente = clienteWhatsApp(), fetchImpl = fetch, log = () => {}, limite = 15 } = {}) {
  if (!cliente) return 0;
  const pend = db.prepare(`SELECT f.* FROM whatsapp_fila f JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.canal = 'whatsapp' AND f.enviado_em IS NULL AND f.tentativas < 3 AND u.whatsapp_ativo = 1 AND f.criado_em >= datetime('now', '-2 days')
    ORDER BY f.id LIMIT ?`).all(limite);
  let n = 0;
  for (const f of pend) {
    try {
      const r = await enviarEdital(db, cliente, f.usuario_id, f.oportunidade_id, { fetchImpl });
      db.prepare("UPDATE whatsapp_fila SET enviado_em = datetime('now'), tentativas = tentativas + 1, resultado = ? WHERE id = ?").run(JSON.stringify(r), f.id);
      n++;
    } catch (e) {
      // Erro de configuração (4xx) não melhora tentando de novo; falha de rede tenta até 3 vezes.
      const definitivo = e.status >= 400 && e.status < 500;
      db.prepare('UPDATE whatsapp_fila SET tentativas = ?, resultado = ? WHERE id = ?').run(definitivo ? 3 : f.tentativas + 1, JSON.stringify({ erro: e.message }), f.id);
      log(`[whatsapp] edital ${f.oportunidade_id}: ${e.message}`);
    }
  }
  return n;
}

/** Avisos dos agentes (sino) também pelo WhatsApp, para quem ativou. */
export async function enviarNotificacoesPorWhatsApp(db, { cliente = clienteWhatsApp(), querWhatsApp = () => true, appUrl = config.appUrl, log = () => {} } = {}) {
  if (!cliente) return 0;
  const pend = db.prepare(`SELECT n.*, u.whatsapp FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id
    WHERE n.enviada_whatsapp = 0 AND u.whatsapp_ativo = 1 AND u.whatsapp IS NOT NULL
      AND n.criado_em >= coalesce(u.whatsapp_desde, datetime('now')) AND n.criado_em >= datetime('now', '-1 day')
    ORDER BY n.id LIMIT 50`).all();
  let n = 0;
  for (const x of pend) {
    let marca = 2; // 2 = não enviada por preferência do usuário
    if (querWhatsApp(x)) {
      try {
        await cliente.enviarAviso(x.whatsapp, x.titulo, [x.mensagem, x.link ? `Abrir: ${appUrl}/#${x.link}` : null].filter(Boolean).join(' · '));
        marca = 1;
        n++;
      } catch (e) {
        log(`[whatsapp] aviso ${x.id}: ${e.message}`);
        if (!(e.status >= 400 && e.status < 500)) continue; // falha de rede: tenta na próxima rodada
        marca = 3;
      }
    }
    db.prepare('UPDATE notificacoes SET enviada_whatsapp = ? WHERE id = ?').run(marca, x.id);
  }
  return n;
}
