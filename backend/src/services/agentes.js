// Agentes que trabalham sozinhos para cada usuário:
// - prospector: encontra licitações novas dos alertas, dá nota e coloca as melhores no funil;
// - vigia: acompanha as licitações do funil e avisa quando algo muda no PNCP;
// - leitor: lê com IA o edital das licitações que entram no funil e completa o checklist.
import { config } from '../config.js';
import { tx } from '../db/index.js';
import { buscarOportunidades } from './busca.js';
import { pagometroDaOportunidade } from './capag.js';
import { parseAlerta, filtrosDoAlerta } from '../routes/alertas.js';
import { CHECKLIST_PADRAO } from '../routes/negocios.js';
import { criarTransporte } from './alertas.js';
import { habilitacaoDoNegocio, resumoHabilitacao } from './habilitacao.js';

export const AGENTES = {
  prospector: {
    nome: 'Agente Prospector',
    descricao: 'Todo dia procura licitações novas dos seus alertas, dá uma nota de 0 a 100 e coloca as melhores no seu funil.',
    padrao: { notaMinima: 60, maxPorDia: 10, empresaId: null, email: true, whatsapp: true, telegram: true, whatsappEdital: true },
  },
  vigia: {
    nome: 'Agente Vigia',
    descricao: 'Acompanha as licitações do seu funil e avisa quando muda data, situação, valor ou sai documento novo no PNCP. Lembra 24h antes da sessão.',
    padrao: { email: true, whatsapp: true, telegram: true, lembrete24h: true },
  },
  leitor: {
    nome: 'Agente Leitor',
    descricao: 'Quando uma licitação entra no funil, lê o edital com IA, coloca no checklist os documentos exigidos e confere se a sua documentação está em dia para participar.',
    padrao: { maxPorDia: 5, email: false, whatsapp: true, telegram: true },
    precisaIA: true,
  },
};

const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');


export function lerConfig(db, uid, agente) {
  const r = db.prepare('SELECT * FROM agentes_config WHERE usuario_id = ? AND agente = ?').get(uid, agente);
  const base = AGENTES[agente].padrao;
  return {
    ativo: !!r?.ativo,
    config: { ...base, ...(r ? JSON.parse(r.config) : {}) },
    ultimaExecucao: r?.ultima_execucao ?? null,
    ultimoResultado: r?.ultimo_resultado ? JSON.parse(r.ultimo_resultado) : null,
  };
}

export function salvarConfig(db, uid, agente, { ativo, config: cfg }) {
  const atual = lerConfig(db, uid, agente);
  const permitido = Object.fromEntries(Object.entries(cfg ?? {}).filter(([k]) => k in AGENTES[agente].padrao));
  db.prepare(`INSERT INTO agentes_config (usuario_id, agente, ativo, config) VALUES (?, ?, ?, ?)
    ON CONFLICT(usuario_id, agente) DO UPDATE SET ativo = excluded.ativo, config = excluded.config`)
    .run(uid, agente, (ativo ?? atual.ativo) ? 1 : 0, JSON.stringify({ ...atual.config, ...permitido }));
  return lerConfig(db, uid, agente);
}

function registrarExecucao(db, uid, agente, resultado) {
  db.prepare(`INSERT INTO agentes_config (usuario_id, agente, ativo, config, ultima_execucao, ultimo_resultado)
    VALUES (?, ?, 0, '{}', datetime('now'), ?)
    ON CONFLICT(usuario_id, agente) DO UPDATE SET ultima_execucao = excluded.ultima_execucao, ultimo_resultado = excluded.ultimo_resultado`)
    .run(uid, agente, JSON.stringify(resultado));
}

export function notificar(db, n) {
  return db.prepare(`INSERT INTO notificacoes (usuario_id, agente, tipo, titulo, mensagem, negocio_id, oportunidade_id, link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(
    n.usuarioId, n.agente, n.tipo, String(n.titulo).slice(0, 300), n.mensagem ? String(n.mensagem).slice(0, 2000) : null,
    n.negocioId ?? null, n.oportunidadeId ?? null, n.link ?? null,
  ).id;
}

// ---------------- Prospector ----------------
/** Nota de 0 a 100 de uma oportunidade para um alerta, com os motivos. */
export function pontuar(db, op, alerta, agora = new Date()) {
  const motivos = [];
  let nota = 0;
  const objeto = norm(op.objeto);
  // 1) Aderência ao que a empresa vende (até 45): fração das palavras do melhor grupo do alerta.
  const grupos = String(alerta.palavras).split(',').map((g) => norm(g).match(/[a-z0-9]{2,}/g) ?? []).filter((g) => g.length);
  const cobertura = Math.max(0, ...grupos.map((g) => g.filter((w) => objeto.includes(w)).length / g.length));
  const inicio = objeto.slice(0, 140);
  const noInicio = grupos.some((g) => g.every((w) => inicio.includes(w)));
  nota += Math.round(35 * cobertura) + (noInicio ? 10 : 0);
  if (cobertura >= 1 && noInicio) motivos.push('As palavras do alerta são o objeto principal da compra');
  else if (cobertura >= 1) motivos.push('Objeto tem todas as palavras do alerta (no meio da descrição)');
  else if (cobertura > 0) motivos.push('Objeto tem parte das palavras do alerta');
  // 2) Tempo para preparar a proposta (até 20).
  const dias = op.data_encerramento ? (new Date(op.data_encerramento) - agora) / 86400000 : null;
  if (dias == null) { nota += 10; motivos.push('Prazo de propostas não informado'); }
  else if (dias >= 5) { nota += 20; motivos.push(`${Math.floor(dias)} dias para preparar a proposta`); }
  else if (dias >= 2) { nota += 10; motivos.push(`Prazo curto: ${Math.floor(dias)} dias`); }
  else motivos.push('Prazo muito curto (menos de 2 dias)');
  // 3) Valor dentro da faixa do alerta (até 15).
  const v = op.valor_estimado;
  const temFaixa = alerta.valor_min != null || alerta.valor_max != null;
  const dentro = (alerta.valor_min == null || v >= alerta.valor_min) && (alerta.valor_max == null || v <= alerta.valor_max);
  if (!v) { nota += 5; motivos.push('Valor estimado não informado'); }
  else if (!temFaixa) { nota += 8; } // sem faixa no alerta: critério neutro
  else if (dentro) { nota += 15; motivos.push('Valor dentro da sua faixa'); }
  else motivos.push('Valor fora da sua faixa');
  // 4) Risco de pagamento (até 20).
  const pag = pagometroDaOportunidade(db, op).nivel;
  const pontosPag = { baixo: 20, federal: 18, medio: 10, alto: 0 }[pag] ?? 10;
  nota += pontosPag;
  motivos.push({ baixo: 'Órgão tende a pagar em dia', federal: 'Órgão federal', medio: 'Pagamento: atenção', alto: 'Risco de atraso no pagamento' }[pag]
    ?? 'Sem nota de pagamento');
  return { nota: Math.min(100, nota), motivos, pagometro: pag };
}

export function executarProspector(db, uid, { agora = new Date() } = {}) {
  const { config: cfg, ultimaExecucao } = lerConfig(db, uid, 'prospector');
  const alertas = db.prepare('SELECT * FROM alertas WHERE usuario_id = ?').all(uid).map(parseAlerta);
  if (!alertas.length) {
    const r = { adicionadas: 0, avaliadas: 0, aviso: 'Crie pelo menos um alerta com as palavras do que sua empresa vende.' };
    registrarExecucao(db, uid, 'prospector', r);
    return r;
  }
  // Desde a última execução (incluindo o mesmo segundo); na primeira vez, os últimos 3 dias.
  // Repetir uma avaliação não duplica: licitações já no funil são ignoradas.
  const desde = ultimaExecucao
    ? db.prepare("SELECT datetime(?, '-1 second') AS t").get(ultimaExecucao).t
    : db.prepare("SELECT datetime('now', '-3 days') AS t").get().t;
  const candidatas = new Map();
  for (const a of alertas) {
    const { itens } = buscarOportunidades(db, { ...filtrosDoAlerta(a), publicadasDesde: desde, tamanho: 100, ordem: 'publicacao' }, uid);
    for (const op of itens) {
      if (op.negocio_id) continue;
      const p = pontuar(db, op, a, agora);
      const atual = candidatas.get(op.id);
      if (!atual || p.nota > atual.nota) candidatas.set(op.id, { op, alerta: a.nome, ...p });
    }
  }
  const escolhidas = [...candidatas.values()].filter((c) => c.nota >= cfg.notaMinima)
    .sort((a, b) => b.nota - a.nota).slice(0, cfg.maxPorDia);
  const ins = db.prepare(`INSERT OR IGNORE INTO negocios (usuario_id, oportunidade_id, empresa_id, titulo, etapa, data_disputa, notas, origem, pontuacao)
    VALUES (?, ?, ?, ?, 'triagem', ?, ?, 'prospector', ?) RETURNING id`);
  const insCheck = db.prepare('INSERT INTO checklist_itens (negocio_id, texto, posicao) VALUES (?, ?, ?)');
  const adicionadas = [];
  tx(db, () => {
    for (const c of escolhidas) {
      const r = ins.get(uid, c.op.id, cfg.empresaId ?? null, c.op.objeto.slice(0, 300), c.op.data_encerramento ?? null,
        `Adicionada pelo Agente Prospector (nota ${c.nota}, alerta "${c.alerta}"):\n- ${c.motivos.join('\n- ')}`, c.nota);
      if (!r) continue;
      CHECKLIST_PADRAO.forEach((t, i) => insCheck.run(r.id, t, i));
      adicionadas.push({ negocioId: r.id, oportunidadeId: c.op.id, nota: c.nota, objeto: c.op.objeto });
    }
  });
  if (adicionadas.length && cfg.whatsappEdital) {
    // O edital de cada licitação nova vai para o celular (WhatsApp e/ou Telegram, conforme ativado).
    const fila = db.prepare("INSERT INTO whatsapp_fila (usuario_id, oportunidade_id, origem, canal) VALUES (?, ?, 'prospector', ?)");
    for (const canal of ['whatsapp', 'telegram'].filter((c) => cfg[c])) for (const a of adicionadas) fila.run(uid, a.oportunidadeId, canal);
  }
  if (adicionadas.length) {
    notificar(db, {
      usuarioId: uid, agente: 'prospector', tipo: 'prospeccao',
      titulo: `${adicionadas.length} licitação(ões) nova(s) no seu funil`,
      mensagem: adicionadas.map((a) => `Nota ${a.nota}: ${a.objeto.slice(0, 120)}`).join('\n'),
      link: '/negocios',
    });
  }
  const r = { adicionadas: adicionadas.length, avaliadas: candidatas.size, notaMinima: cfg.notaMinima };
  registrarExecucao(db, uid, 'prospector', r);
  return r;
}

// ---------------- Vigia ----------------
const CAMPOS_VIGIADOS = {
  data_encerramento: 'Prazo de propostas',
  data_abertura: 'Início das propostas',
  situacao: 'Situação',
  valor_estimado: 'Valor estimado',
};
const fmtValor = (campo, v) => {
  if (v == null || v === '') return 'não informado';
  if (campo === 'valor_estimado') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (campo.startsWith('data_')) return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  return String(v);
};

async function arquivosDoPncp(op, fetchImpl) {
  if (!op.orgao_cnpj || !op.ano_compra || !op.sequencial_compra) return null;
  const base = config.pncpBaseUrl.replace(/\/api\/consulta$/, '/api/pncp');
  const res = await fetchImpl(`${base}/v1/orgaos/${op.orgao_cnpj}/compras/${op.ano_compra}/${op.sequencial_compra}/arquivos`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (res.status === 204 || res.status === 404) return [];
  if (!res.ok) return null;
  return (await res.json()).filter((a) => a.statusAtivo !== false)
    .map((a) => ({ seq: a.sequencialDocumento, tipo: a.tipoDocumentoNome ?? 'Documento', titulo: a.titulo ?? '' }));
}

export async function executarVigia(db, uid, { fetchImpl = fetch, consultarArquivos = true, agora = new Date() } = {}) {
  const { config: cfg } = lerConfig(db, uid, 'vigia');
  const negocios = db.prepare(`SELECT n.id AS negocio_id, n.titulo, n.data_disputa, o.*
    FROM negocios n JOIN oportunidades o ON o.id = n.oportunidade_id
    WHERE n.usuario_id = ? AND n.arquivado = 0 AND n.etapa NOT IN ('ganho', 'perdido')`).all(uid);
  const getSnap = db.prepare('SELECT * FROM vigia_snapshot WHERE negocio_id = ?');
  const setSnap = db.prepare(`INSERT INTO vigia_snapshot (negocio_id, dados, arquivos, verificado_em) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(negocio_id) DO UPDATE SET dados = excluded.dados, arquivos = coalesce(excluded.arquivos, vigia_snapshot.arquivos), verificado_em = excluded.verificado_em`);
  let mudancas = 0;
  let lembretes = 0;
  for (const n of negocios) {
    const dados = Object.fromEntries(Object.keys(CAMPOS_VIGIADOS).map((c) => [c, n[c] ?? null]));
    let arquivos = null;
    if (consultarArquivos) {
      try { arquivos = await arquivosDoPncp(n, fetchImpl); } catch { arquivos = null; }
    }
    const snap = getSnap.get(n.negocio_id);
    if (snap) {
      const antes = JSON.parse(snap.dados);
      const diffs = Object.entries(CAMPOS_VIGIADOS).filter(([c]) => String(antes[c] ?? '') !== String(dados[c] ?? ''))
        .map(([c, nome]) => ({ campo: c, nome, de: antes[c], para: dados[c] }));
      if (diffs.length) {
        const grave = diffs.some((d) => d.campo === 'situacao' && /suspen|revog|anul|cancel|desert|fracass/i.test(d.para ?? ''));
        notificar(db, {
          usuarioId: uid, agente: 'vigia', tipo: grave ? 'mudanca_grave' : 'mudanca', negocioId: n.negocio_id, oportunidadeId: n.id,
          titulo: `${grave ? 'Atenção: ' : ''}mudou ${diffs.map((d) => d.nome.toLowerCase()).join(', ')} em "${n.titulo.slice(0, 80)}"`,
          mensagem: diffs.map((d) => `${d.nome}: ${fmtValor(d.campo, d.de)} → ${fmtValor(d.campo, d.para)}`).join('\n'),
          link: `/negocios/${n.negocio_id}`,
        });
        mudancas++;
        // Se a data da disputa do negócio vinha do prazo antigo, acompanha o novo prazo.
        const prazo = diffs.find((d) => d.campo === 'data_encerramento');
        if (prazo && n.data_disputa && antes.data_encerramento && n.data_disputa.slice(0, 16) === String(antes.data_encerramento).slice(0, 16)) {
          db.prepare("UPDATE negocios SET data_disputa = ?, atualizado_em = datetime('now') WHERE id = ?").run(prazo.para, n.negocio_id);
        }
      }
      if (arquivos && snap.arquivos) {
        const vistos = new Set(JSON.parse(snap.arquivos).map((a) => a.seq));
        const novos = arquivos.filter((a) => !vistos.has(a.seq));
        if (novos.length) {
          notificar(db, {
            usuarioId: uid, agente: 'vigia', tipo: 'documento', negocioId: n.negocio_id, oportunidadeId: n.id,
            titulo: `${novos.length} documento(s) novo(s) no PNCP: "${n.titulo.slice(0, 80)}"`,
            mensagem: novos.map((a) => `${a.tipo}${a.titulo ? ` — ${a.titulo}` : ''}`).join('\n'),
            link: `/negocios/${n.negocio_id}`,
          });
          mudancas++;
        }
      }
    }
    setSnap.run(n.negocio_id, JSON.stringify(dados), arquivos ? JSON.stringify(arquivos) : null);

    // Lembrete 24h antes da disputa (uma vez por negócio).
    const disputa = n.data_disputa ? new Date(n.data_disputa) : null;
    if (cfg.lembrete24h && disputa && disputa > agora && disputa - agora <= 24 * 3600000
      && !db.prepare("SELECT 1 FROM notificacoes WHERE negocio_id = ? AND tipo = 'lembrete'").get(n.negocio_id)) {
      notificar(db, {
        usuarioId: uid, agente: 'vigia', tipo: 'lembrete', negocioId: n.negocio_id, oportunidadeId: n.id,
        titulo: `Disputa em menos de 24h: "${n.titulo.slice(0, 80)}"`,
        mensagem: `Sessão marcada para ${fmtValor('data_disputa', n.data_disputa)}. Confira o checklist e os documentos.`,
        link: `/negocios/${n.negocio_id}`,
      });
      lembretes++;
    }
  }
  const r = { acompanhadas: negocios.length, mudancas, lembretes };
  registrarExecucao(db, uid, 'vigia', r);
  return r;
}

// ---------------- Leitor ----------------
export async function executarLeitor(db, uid, { client, fetchImpl = fetch, resumir } = {}) {
  const { config: cfg } = lerConfig(db, uid, 'leitor');
  if (!client) {
    const r = { lidos: 0, aviso: 'A leitura com IA não está configurada (falta ANTHROPIC_API_KEY).' };
    registrarExecucao(db, uid, 'leitor', r);
    return r;
  }
  const hoje = db.prepare("SELECT count(*) AS n FROM notificacoes WHERE usuario_id = ? AND agente = 'leitor' AND criado_em >= datetime('now', 'start of day')").get(uid).n;
  const limite = Math.max(0, cfg.maxPorDia - hoje);
  // Negócios ativos com licitação cujo edital ainda não foi lido por este agente.
  const pendentes = db.prepare(`SELECT n.id AS negocio_id, n.titulo, o.* FROM negocios n JOIN oportunidades o ON o.id = n.oportunidade_id
    WHERE n.usuario_id = ? AND n.arquivado = 0 AND n.etapa NOT IN ('ganho', 'perdido')
      AND NOT EXISTS (SELECT 1 FROM notificacoes x WHERE x.negocio_id = n.id AND x.agente = 'leitor')
    ORDER BY n.criado_em DESC LIMIT ?`).all(uid, limite);
  let lidos = 0;
  const erros = [];
  for (const n of pendentes) {
    try {
      const { resumo } = await resumir(db, n, uid, { client, fetchImpl });
      const docs = resumo.documentos_habilitacao ?? [];
      const pos = db.prepare('SELECT coalesce(max(posicao), -1) + 1 AS p FROM checklist_itens WHERE negocio_id = ?').get(n.negocio_id).p;
      const ins = db.prepare('INSERT INTO checklist_itens (negocio_id, texto, posicao) VALUES (?, ?, ?)');
      tx(db, () => docs.forEach((d, i) => ins.run(n.negocio_id, `Documento: ${d.descricao}`.slice(0, 500), pos + i)));
      const habil = resumoHabilitacao(habilitacaoDoNegocio(db, uid, n.negocio_id));
      notificar(db, {
        usuarioId: uid, agente: 'leitor', tipo: 'edital_lido', negocioId: n.negocio_id, oportunidadeId: n.id,
        titulo: `Edital lido: "${n.titulo.slice(0, 80)}"`,
        mensagem: [habil, resumo.resumo, docs.length ? `${docs.length} documento(s) de habilitação adicionados ao checklist.` : null,
          ...(resumo.pontos_atencao ?? []).slice(0, 3).map((p) => `Atenção: ${p}`)].filter(Boolean).join('\n'),
        link: `/negocios/${n.negocio_id}`,
      });
      lidos++;
    } catch (e) {
      erros.push(`${n.titulo.slice(0, 60)}: ${e.message}`);
    }
  }
  const r = { lidos, pendentes: pendentes.length, erros: erros.slice(0, 3) };
  registrarExecucao(db, uid, 'leitor', r);
  return r;
}

// ---------------- E-mail das notificações ----------------
export async function enviarNotificacoesPorEmail(db, { transport = criarTransporte() } = {}) {
  if (!transport) return 0;
  const pend = db.prepare(`SELECT n.*, u.email FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id
    WHERE n.enviada_email = 0 AND n.criado_em >= datetime('now', '-1 day') ORDER BY n.usuario_id, n.id`).all();
  const porUsuario = Map.groupBy(pend, (n) => n.usuario_id);
  let enviados = 0;
  for (const [uid, lista] of porUsuario) {
    // Avisos que não são de um agente (ex.: chat do pregoeiro) sempre vão por e-mail.
    const querem = lista.filter((n) => (AGENTES[n.agente] ? lerConfig(db, uid, n.agente).config.email : true));
    if (querem.length) {
      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2 style="color:#1d4ed8">Busca Pregão IA</h2>
        ${querem.map((n) => `<div style="padding:10px 0;border-bottom:1px solid #e5e7eb"><b>${esc(n.titulo)}</b>
        <div style="white-space:pre-line;color:#475569;font-size:13px">${esc(n.mensagem)}</div>
        ${n.link ? `<a href="${esc(config.appUrl)}/#${esc(n.link)}" style="color:#1d4ed8;font-size:13px">Abrir</a>` : ''}</div>`).join('')}
        <p style="color:#94a3b8;font-size:12px">Avisos dos seus agentes. Desligue o e-mail de cada agente na página Agentes.</p></div>`;
      await transport.sendMail({ from: config.smtp.from, to: querem[0].email, subject: `${querem.length} aviso(s) dos seus agentes`, html });
      enviados++;
    }
    db.prepare(`UPDATE notificacoes SET enviada_email = 1 WHERE id IN (${lista.map(() => '?').join(',')})`).run(...lista.map((n) => n.id));
  }
  return enviados;
}

/** Usuários com o agente ligado. */
export function usuariosCom(db, agente) {
  return db.prepare('SELECT usuario_id FROM agentes_config WHERE agente = ? AND ativo = 1').all(agente).map((r) => r.usuario_id);
}



/** O usuário quer receber este aviso no WhatsApp? (preferência por agente; outros avisos sempre) */
export const querWhatsApp = (db) => (n) => (AGENTES[n.agente] ? !!lerConfig(db, n.usuario_id, n.agente).config.whatsapp : true);
export const querTelegram = (db) => (n) => (AGENTES[n.agente] ? !!lerConfig(db, n.usuario_id, n.agente).config.telegram : true);
