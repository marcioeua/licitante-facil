// Tarefas automáticas dentro do próprio servidor (sem cron externo):
// - carga completa do PNCP 1x por dia (madrugada) ou quando o banco está vazio;
// - atualização incremental a cada 2 horas;
// - e-mails de alertas 1x por dia às 7h30 (se o SMTP estiver configurado).
import { config } from '../config.js';
import { sincronizarPropostasAbertas, sincronizarAtualizacoes } from '../services/pncp.js';
import { enviarAlertas } from '../services/alertas.js';
import { atualizarCapag } from '../services/capag.js';
import { atualizarOrgaos } from '../services/orgaos.js';
import { arquivarVencidas, usuariosCom, executarVigia, executarProspector, executarLeitor, enviarNotificacoesPorEmail, querWhatsApp, querTelegram } from '../services/agentes.js';
import { clienteTelegram, processarMensagensTelegram, enviarNotificacoesPorTelegram, processarFilaTelegram } from '../services/telegram.js';
import { enviarNotificacoesPorWhatsApp, processarFilaWhatsApp } from '../services/whatsapp.js';
import { resumirEdital } from '../services/editalIA.js';
import { proximoDiaContratos, importarContratosDoDia, limparHistoricoAntigo, liberarEspaco } from '../services/historico.js';
import { proximoDiaItens, importarItensDoDia, completarCabecalhos, limparItensAntigos, importarItensDasOportunidades } from '../services/itens.js';

const FUSO = 'America/Sao_Paulo';
const HORA_COMPLETA = 3; // 3h da manhã
const HORA_ALERTAS = 7;
const MINUTO_ALERTAS = 30;
const INTERVALO_INCREMENTAL_MS = 2 * 3600 * 1000;

/** Data (AAAA-MM-DD), hora e minuto no horário de Brasília. */
export function agoraBrasilia(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), minuto: Number(p.minute) };
}

const utc = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);

/** Decide o que rodar agora, a partir do histórico gravado no banco. Função pura para testes. */
export function proximaTarefa(db, agora = new Date()) {
  const ultima = (tipo, comSucesso) => db.prepare(`
    SELECT iniciado_em FROM sincronizacoes WHERE tipo = ? ${comSucesso ? 'AND erro IS NULL AND finalizado_em IS NOT NULL' : ''}
    ORDER BY id DESC LIMIT 1`).get(tipo)?.iniciado_em ?? null;
  const br = agoraBrasilia(agora);
  const completaOk = utc(ultima('completa', true));
  // Cargas interrompidas por reinício não contam para a espera de 2h: retoma logo.
  const completaTentativa = utc(db.prepare(`
    SELECT iniciado_em FROM sincronizacoes WHERE tipo = 'completa' AND (erro IS NULL OR erro NOT LIKE 'interrompida%')
    ORDER BY id DESC LIMIT 1`).get()?.iniciado_em ?? null);
  const qualquer = [completaTentativa, utc(ultima('incremental', false))].filter(Boolean).sort((a, b) => b - a)[0];

  // Carga completa cortada por reinício nas últimas 12h: continua de onde parou.
  const cortada = db.prepare(`
    SELECT id, iniciado_em, progresso FROM sincronizacoes
    WHERE tipo = 'completa' AND erro LIKE 'interrompida%' AND progresso IS NOT NULL
    ORDER BY id DESC LIMIT 1`).get();
  const cortadaEm = utc(cortada?.iniciado_em);
  if (cortada && agora - cortadaEm < 12 * 3600000 && (!completaOk || cortadaEm > completaOk)
    && !db.prepare("SELECT 1 FROM sincronizacoes WHERE tipo = 'completa' AND id > ? AND erro IS NULL").get(cortada.id)) {
    try {
      return { tipo: 'completa', retomar: JSON.parse(cortada.progresso) };
    } catch { /* progresso inválido: segue a regra normal */ }
  }
  // Nunca carregou com sucesso: carga completa (tentando no máximo a cada 2h).
  if (!completaOk) {
    if (!completaTentativa || agora - completaTentativa >= INTERVALO_INCREMENTAL_MS) return { tipo: 'completa' };
    return null;
  }
  // Carga completa diária na madrugada.
  if (br.hora >= HORA_COMPLETA && br.hora < HORA_COMPLETA + 3 && agoraBrasilia(completaOk).data !== br.data
    && (!completaTentativa || agoraBrasilia(completaTentativa).data !== br.data)) {
    return { tipo: 'completa' };
  }
  if (!qualquer || agora - qualquer >= INTERVALO_INCREMENTAL_MS) {
    // Busca alterações desde o dia da última sincronização bem-sucedida.
    const desdeSync = [completaOk, utc(ultima('incremental', true))].filter(Boolean).sort((a, b) => b - a)[0];
    return { tipo: 'incremental', desde: new Date(Math.min(desdeSync.getTime(), agora - 86400000)) };
  }
  return null;
}

/** CAPAG: carrega se a tabela estiver vazia e depois atualiza 1x por semana. */
export function capagPendente(db, agora = new Date()) {
  if (!db.prepare('SELECT 1 FROM capag_entes LIMIT 1').get()) {
    const tentou = db.prepare("SELECT ultima_execucao FROM tarefas WHERE nome = 'capag_tentativa'").get()?.ultima_execucao;
    return !tentou || agora - utc(tentou) >= INTERVALO_INCREMENTAL_MS; // após falha, tenta de novo em 2h
  }
  const ultima = db.prepare("SELECT ultima_execucao FROM tarefas WHERE nome = 'capag'").get()?.ultima_execucao;
  return !ultima || agora - utc(ultima) >= 7 * 86400000;
}

export function alertasPendentes(db, agora = new Date()) {
  const br = agoraBrasilia(agora);
  if (br.hora * 60 + br.minuto < HORA_ALERTAS * 60 + MINUTO_ALERTAS) return false;
  const ultima = db.prepare("SELECT ultima_execucao FROM tarefas WHERE nome = 'alertas'").get()?.ultima_execucao;
  return ultima !== br.data;
}

/** Sincronizações sem fim registrado foram cortadas por um reinício do servidor. */
export function marcarInterrompidas(db) {
  return db.prepare(`UPDATE sincronizacoes SET finalizado_em = datetime('now'), erro = 'interrompida (reinício do servidor)'
    WHERE finalizado_em IS NULL`).run().changes;
}

const ultimaTarefa = (db, nome) => db.prepare('SELECT ultima_execucao FROM tarefas WHERE nome = ?').get(nome)?.ultima_execucao ?? null;
const marcarTarefa = (db, nome, valor) => db.prepare('INSERT OR REPLACE INTO tarefas (nome, ultima_execucao) VALUES (?, ?)').run(nome, valor);

/** Agentes: Vigia a cada 2h, Prospector 1x por dia a partir das 7h, Leitor a cada 30 min. */
export async function executarAgentesAgendados(db, { log = console.log, ia = null, fetchImpl = fetch, agora = new Date() } = {}) {
  // Resumo dos órgãos: uma vez por dia (madrugada) ou se ainda não existe.
  try {
    const hoje = agoraBrasilia(agora).data;
    if (ultimaTarefa(db, 'orgaos') !== hoje && (agoraBrasilia(agora).hora >= 5 || !db.prepare('SELECT 1 FROM orgaos LIMIT 1').get())) {
      marcarTarefa(db, 'orgaos', hoje);
      log(`[orgaos] ${atualizarOrgaos(db)} órgão(s) atualizados`);
    }
  } catch (e) { log(`[orgaos] ${e.message}`); }
  try { const n = arquivarVencidas(db); if (n) log(`[agentes] ${n} licitação(ões) vencida(s) saíram da triagem`); } catch (e) { log(`[agentes] arquivar vencidas: ${e.message}`); }
  const passou = (nome, ms) => {
    const u = ultimaTarefa(db, nome);
    return !u || agora - utc(u) >= ms;
  };
  const agoraTxt = agora.toISOString().slice(0, 19).replace('T', ' ');
  if (passou('agente_vigia', INTERVALO_INCREMENTAL_MS)) {
    marcarTarefa(db, 'agente_vigia', agoraTxt);
    for (const uid of usuariosCom(db, 'vigia')) {
      try { await executarVigia(db, uid, { fetchImpl, agora }); } catch (e) { log(`[agentes] vigia ${uid}: ${e.message}`); }
    }
  }
  const br = agoraBrasilia(agora);
  if (br.hora >= 7 && ultimaTarefa(db, 'agente_prospector') !== br.data) {
    marcarTarefa(db, 'agente_prospector', br.data);
    for (const uid of usuariosCom(db, 'prospector')) {
      try { executarProspector(db, uid, { agora }); } catch (e) { log(`[agentes] prospector ${uid}: ${e.message}`); }
    }
  }
  if (ia && passou('agente_leitor', 30 * 60000)) {
    marcarTarefa(db, 'agente_leitor', agoraTxt);
    for (const uid of usuariosCom(db, 'leitor')) {
      try { await executarLeitor(db, uid, { client: ia, fetchImpl, resumir: resumirEdital, agendado: true }); } catch (e) { log(`[agentes] leitor ${uid}: ${e.message}`); }
    }
  }
  try { await enviarNotificacoesPorEmail(db); } catch (e) { log(`[agentes] e-mail: ${e.message}`); }
  try { await enviarNotificacoesPorWhatsApp(db, { querWhatsApp: querWhatsApp(db), log }); } catch (e) { log(`[agentes] whatsapp: ${e.message}`); }
  try { await processarFilaWhatsApp(db, { fetchImpl, log }); } catch (e) { log(`[agentes] whatsapp editais: ${e.message}`); }
  const tg = clienteTelegram();
  if (tg) {
    try { await processarMensagensTelegram(db, tg, { log }); } catch (e) { log(`[agentes] telegram mensagens: ${e.message}`); }
    try { await enviarNotificacoesPorTelegram(db, { cliente: tg, querTelegram: querTelegram(db), log }); } catch (e) { log(`[agentes] telegram: ${e.message}`); }
    try { await processarFilaTelegram(db, { cliente: tg, fetchImpl, log }); } catch (e) { log(`[agentes] telegram editais: ${e.message}`); }
  }
}

export function iniciarAgendador(db, { log = console.log, intervaloMs = 5 * 60 * 1000, ia = null } = {}) {
  const n = marcarInterrompidas(db);
  if (n) log(`[agendador] ${n} sincronização(ões) interrompida(s) pelo reinício; retomando`);
  let ocupado = false;
  async function tick() {
    if (ocupado) return;
    ocupado = true;
    try {
      // CAPAG primeiro: é rápida (cerca de 1 min) e a carga do PNCP pode levar 40 min.
      if (capagPendente(db)) {
        db.prepare("INSERT OR REPLACE INTO tarefas (nome, ultima_execucao) VALUES ('capag_tentativa', datetime('now'))").run();
        try {
          await atualizarCapag(db, { log });
          db.prepare("INSERT OR REPLACE INTO tarefas (nome, ultima_execucao) VALUES ('capag', datetime('now'))").run();
        } catch (e) {
          log(`[agendador] CAPAG: ${e.message}`);
        }
      }
      const t = proximaTarefa(db);
      if (t?.tipo === 'completa') {
        log(t.retomar
          ? `[agendador] retomando carga completa do PNCP (modalidade ${t.retomar.modalidade}, página ${t.retomar.pagina})`
          : '[agendador] carga completa do PNCP iniciada');
        const r = await sincronizarPropostasAbertas(db, { log: () => {}, retomar: t.retomar });
        log(`[agendador] carga completa concluída: ${r.importadas} registros`);
      } else if (t?.tipo === 'incremental') {
        log(`[agendador] atualização incremental desde ${t.desde.toISOString().slice(0, 10)}`);
        const r = await sincronizarAtualizacoes(db, { desde: t.desde, log: () => {} });
        log(`[agendador] atualização concluída: ${r.importadas} registros`);
      }
      // Disco quase cheio: libera espaço apagando o dia mais antigo do histórico.
      const liberados = liberarEspaco(db);
      if (liberados) log(`[agendador] disco quase cheio: ${liberados} contratos antigos removidos`);
      // Contratos (histórico de compras) quando não há carga de licitações nesta rodada.
      if (!t) {
        const dia = proximoDiaContratos(db);
        if (dia) {
          const n = await importarContratosDoDia(db, dia);
          log(`[agendador] contratos de ${dia}: ${n}`);
          limparHistoricoAntigo(db);
        }
        // Itens das licitações (busca por item): um dia por rodada e os cabeçalhos que faltam.
        try {
          const diaItens = proximoDiaItens(db);
          if (diaItens) {
            const n = await importarItensDoDia(db, diaItens);
            log(`[agendador] itens de licitações de ${diaItens}: ${n}`);
            limparItensAntigos(db);
          }
          const ab = await importarItensDasOportunidades(db, { max: 200 });
          if (ab.feitas) log(`[agendador] itens de licitações abertas (PNCP): ${ab.feitas} licitações`);
          await completarCabecalhos(db, { max: 300 });
        } catch (e) {
          log(`[agendador] itens de licitações: ${e.message}`);
        }
      }
      await executarAgentesAgendados(db, { log, ia });
      if (alertasPendentes(db)) {
        if (config.smtp.host) {
          const r = await enviarAlertas(db);
          log(`[agendador] alertas: ${r.enviados} e-mails enviados`);
        }
        db.prepare('INSERT OR REPLACE INTO tarefas (nome, ultima_execucao) VALUES (?, ?)').run('alertas', agoraBrasilia().data);
      }
    } catch (e) {
      log(`[agendador] erro: ${e.message}`);
    } finally {
      ocupado = false;
    }
  }
  const timer = setInterval(tick, intervaloMs);
  setTimeout(tick, 5000); // primeira verificação logo após subir
  return () => clearInterval(timer);
}
