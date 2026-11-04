import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(root, 'data', 'licitante.db'),
  uploadDir: process.env.UPLOAD_DIR ?? resolve(root, 'data', 'uploads'),
  // Se não for definido, server.js gera um e guarda no banco.
  sessionSecret: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  sessionDays: 30,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:9000',
  frontendDist: process.env.FRONTEND_DIST ?? resolve(root, '..', 'frontend', 'dist', 'spa'),
  pncpBaseUrl: process.env.PNCP_BASE_URL ?? 'https://pncp.gov.br/api/consulta',
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? 'Busca Pregão IA <nao-responda@buscapregaoia.com.br>',
  },
  // No Railway, o domínio público vem em RAILWAY_PUBLIC_DOMAIN.
  appUrl: process.env.APP_URL
    ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:9000'),
};
