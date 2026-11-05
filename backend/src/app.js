import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { lerToken } from './services/auth.js';
import { clienteIA } from './services/editalIA.js';
import authRoutes from './routes/auth.js';
import oportunidadesRoutes from './routes/oportunidades.js';
import negociosRoutes from './routes/negocios.js';
import documentosRoutes from './routes/documentos.js';
import empresasRoutes from './routes/empresas.js';
import alertasRoutes from './routes/alertas.js';
import agendaRoutes from './routes/agenda.js';
import { buscarEntes } from './services/capag.js';
import { consultarContratos, pesquisarPrecos, disco } from './services/historico.js';
import { analisarMercado, analisarEmpresa, rankingMercado } from './services/mercado.js';
import { sugerirEmpresas, perfilEmpresa, compararEmpresas } from './services/empresas.js';
import dashboardRoutes from './routes/dashboard.js';
import agentesRoutes, { notificacoesRoutes } from './routes/agentes.js';

import { COOKIE } from './http.js';

export async function buildApp({ db, logger = false, serveFrontend = true, ia, fetchImpl = fetch, fetchCnpj } = {}) {
  const app = Fastify({ logger });
  app.decorate('db', db);
  // Cliente da IA (Claude) e fetch do PNCP: injetáveis nos testes.
  app.decorate('ia', ia === undefined ? clienteIA() : ia);
  app.decorate('fetchPncp', fetchImpl);
  app.decorate('fetchCnpj', fetchCnpj ?? fetch);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.decorateRequest('usuarioId', null);
  app.addHook('onRequest', async (req) => {
    req.usuarioId = lerToken(req.cookies[COOKIE]);
  });
  // Protege tudo em /api, exceto login/cadastro.
  app.addHook('preHandler', async (req, reply) => {
    const url = req.routeOptions.url ?? '';
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/') && url !== '/api/saude' && !req.usuarioId) {
      return reply.code(401).send({ erro: 'Faça login para continuar.' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ erro: 'Dados inválidos.', detalhes: err.validation });
    if (err.expose || (err.statusCode && err.statusCode < 500)) return reply.code(err.statusCode).send({ erro: err.message });
    req.log.error(err);
    reply.code(500).send({ erro: 'Erro interno. Tente novamente.' });
  });

  // Verificação de saúde para a hospedagem (pública, sem dados sensíveis).
  app.get('/api/saude', async () => {
    db.prepare('SELECT 1').get();
    const u = db.prepare('SELECT finalizado_em, erro FROM sincronizacoes WHERE finalizado_em IS NOT NULL ORDER BY id DESC LIMIT 1').get();
    const d = disco();
    const hist = db.prepare('SELECT min(dia) AS de, count(*) AS dias FROM contratos_dias').get();
    return {
      ok: true, ultimaSincronizacao: u?.finalizado_em ?? null, ia: !!app.ia,
      disco: d ? { totalMb: Math.round(d.total), livreMb: Math.round(d.livre), usoPct: Math.round(d.usoPct * 100) } : null,
      historico: { desde: hist.de, dias: hist.dias },
    };
  });

  // Pagômetro: busca de estados e municípios pela nota de capacidade de pagamento.
  app.get('/api/pagometro', async (req) => buscarEntes(db, req.query));

  // Histórico de compras: quem comprou, quem venceu e por quanto.
  app.get('/api/historico/contratos', async (req) => consultarContratos(db, req.query));
  app.get('/api/historico/precos', async (req, reply) => {
    if (String(req.query.q ?? '').trim().length < 3) return reply.code(400).send({ erro: 'Digite pelo menos 3 letras do item.' });
    try {
      return await pesquisarPrecos(db, req.query, { fetchImpl: app.fetchPncp });
    } catch (e) {
      req.log.warn(e);
      return reply.code(502).send({ erro: 'Não foi possível consultar o PNCP agora. Tente novamente em instantes.' });
    }
  });

  // Análise de mercado (contratos do PNCP).
  // Cache curto: as agregações sobre um ano de contratos são pesadas e os dados mudam poucas vezes ao dia.
  const cacheMercado = new Map();
  const comCache = (chave, fn) => {
    const c = cacheMercado.get(chave);
    if (c && Date.now() - c.em < 30 * 60000) return c.valor;
    const valor = fn();
    if (cacheMercado.size > 300) cacheMercado.delete(cacheMercado.keys().next().value);
    cacheMercado.set(chave, { valor, em: Date.now() });
    return valor;
  };
  const chaveQ = (prefixo, q) => prefixo + JSON.stringify(Object.entries(q).sort());
  app.get('/api/mercado', async (req) => comCache(chaveQ('m', req.query), () => analisarMercado(db, req.query)));
  app.get('/api/mercado/ranking/:tipo', async (req, reply) =>
    comCache(chaveQ(`r${req.params.tipo}`, req.query), () => rankingMercado(db, req.params.tipo, req.query))
    ?? reply.code(404).send({ erro: 'Ângulo de análise desconhecido.' }));
  app.get('/api/mercado/empresa/:ni', async (req, reply) => {
    if (String(req.params.ni).replace(/\D/g, '').length < 11) return reply.code(400).send({ erro: 'CNPJ inválido.' });
    return analisarEmpresa(db, req.params.ni, req.query);
  });

  // Análise de empresas fornecedoras.
  app.get('/api/analise-empresas/sugestoes', async (req) => sugerirEmpresas(db, req.query.q));
  app.get('/api/analise-empresas/comparar', async (req) => compararEmpresas(db, String(req.query.cnpjs ?? '').split(','), req.query));
  app.get('/api/analise-empresas/:ni', async (req, reply) => {
    if (String(req.params.ni).replace(/\D/g, '').length < 11) return reply.code(400).send({ erro: 'CNPJ inválido.' });
    return perfilEmpresa(db, req.params.ni, req.query, { fetchImpl: app.fetchCnpj ?? fetch });
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(oportunidadesRoutes, { prefix: '/api/oportunidades' });
  await app.register(negociosRoutes, { prefix: '/api/negocios' });
  await app.register(documentosRoutes, { prefix: '/api/documentos' });
  await app.register(empresasRoutes, { prefix: '/api/empresas' });
  await app.register(alertasRoutes, { prefix: '/api/alertas' });
  await app.register(agendaRoutes, { prefix: '/api/agenda' });
  await app.register(agentesRoutes, { prefix: '/api/agentes' });
  await app.register(notificacoesRoutes, { prefix: '/api/notificacoes' });

  // Em produção o backend também entrega o front-end compilado (SPA).
  if (serveFrontend && existsSync(config.frontendDist)) {
    await app.register(fastifyStatic, { root: config.frontendDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ erro: 'Não encontrado.' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
