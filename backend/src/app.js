import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { lerToken } from './services/auth.js';
import authRoutes from './routes/auth.js';
import oportunidadesRoutes from './routes/oportunidades.js';
import negociosRoutes from './routes/negocios.js';
import documentosRoutes from './routes/documentos.js';
import empresasRoutes from './routes/empresas.js';
import alertasRoutes from './routes/alertas.js';
import agendaRoutes from './routes/agenda.js';
import dashboardRoutes from './routes/dashboard.js';

import { COOKIE } from './http.js';

export async function buildApp({ db, logger = false, serveFrontend = true } = {}) {
  const app = Fastify({ logger });
  app.decorate('db', db);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.decorateRequest('usuarioId', null);
  app.addHook('onRequest', async (req) => {
    req.usuarioId = lerToken(req.cookies[COOKIE]);
  });
  // Protege tudo em /api, exceto login/cadastro.
  app.addHook('preHandler', async (req, reply) => {
    const url = req.routeOptions.url ?? '';
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/') && !req.usuarioId) {
      return reply.code(401).send({ erro: 'Faça login para continuar.' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ erro: 'Dados inválidos.', detalhes: err.validation });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ erro: err.message });
    req.log.error(err);
    reply.code(500).send({ erro: 'Erro interno. Tente novamente.' });
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(oportunidadesRoutes, { prefix: '/api/oportunidades' });
  await app.register(negociosRoutes, { prefix: '/api/negocios' });
  await app.register(documentosRoutes, { prefix: '/api/documentos' });
  await app.register(empresasRoutes, { prefix: '/api/empresas' });
  await app.register(alertasRoutes, { prefix: '/api/alertas' });
  await app.register(agendaRoutes, { prefix: '/api/agenda' });

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
