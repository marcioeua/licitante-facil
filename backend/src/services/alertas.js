import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { buscarOportunidades } from './busca.js';
import { parseAlerta, filtrosDoAlerta } from '../routes/alertas.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (v == null ? 'Não informado' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function montarEmail(alerta, itens) {
  const linhas = itens.map((o) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-weight:600;color:#0f172a">${esc(o.objeto.slice(0, 300))}</div>
      <div style="color:#475569;font-size:13px;margin-top:4px">${esc(o.orgao_nome)} · ${esc(o.municipio)}/${esc(o.uf)} · ${esc(o.modalidade)}</div>
      <div style="color:#475569;font-size:13px">Valor estimado: ${brl(o.valor_estimado)} · Propostas até ${dataBr(o.data_encerramento)}</div>
      <a href="${esc(config.appUrl)}/#/oportunidades/${o.id}" style="color:#1d4ed8;font-size:13px">Ver no Busca Pregão IA</a>
    </td></tr>`).join('');
  return {
    subject: `${itens.length} nova(s) licitação(ões) para "${alerta.nome}"`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
      <h2 style="color:#1d4ed8">Busca Pregão IA</h2>
      <p>Encontramos <b>${itens.length}</b> oportunidade(s) nova(s) para o alerta <b>${esc(alerta.nome)}</b>.</p>
      <table style="width:100%;border-collapse:collapse">${linhas}</table>
      <p style="color:#94a3b8;font-size:12px">Você recebe este e-mail porque ativou o alerta no Busca Pregão IA.</p></div>`,
  };
}

export async function enviarAlertas(db, { transport } = {}) {
  transport ??= config.smtp.host
    ? nodemailer.createTransport({
        host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      })
    : null;
  if (!transport) throw new Error('Configure SMTP_HOST (e SMTP_USER/SMTP_PASS) para enviar alertas.');

  const alertas = db.prepare(`
    SELECT a.*, u.email AS usuario_email FROM alertas a JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.email_ativo = 1`).all();
  let enviados = 0;
  let semNovidade = 0;
  for (const raw of alertas) {
    const a = parseAlerta(raw);
    const agora = db.prepare("SELECT datetime('now') AS t").get().t;
    const desde = a.ultimo_envio ?? db.prepare("SELECT datetime('now', '-1 day') AS t").get().t;
    const { itens } = buscarOportunidades(db, { ...filtrosDoAlerta(a), publicadasDesde: desde, tamanho: 50, ordem: 'publicacao' });
    if (itens.length) {
      const { subject, html } = montarEmail(a, itens);
      await transport.sendMail({ from: config.smtp.from, to: raw.usuario_email, subject, html });
      enviados++;
    } else {
      semNovidade++;
    }
    db.prepare('UPDATE alertas SET ultimo_envio = ? WHERE id = ?').run(agora, a.id);
  }
  return { enviados, semNovidade };
}
