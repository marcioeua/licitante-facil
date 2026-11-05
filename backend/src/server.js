import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { buildApp } from './app.js';
import { iniciarAgendador } from './jobs/agendador.js';
import { clienteIA } from './services/editalIA.js';
import { randomBytes } from 'node:crypto';

const db = openDatabase(config.dbPath);

// Sem SESSION_SECRET definido, gera um segredo aleatório uma vez e guarda no banco
// (que fica no volume persistente), para os logins sobreviverem a reinícios.
if (!process.env.SESSION_SECRET) {
  db.exec('CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)').run('session_secret', randomBytes(32).toString('hex'));
  config.sessionSecret = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'session_secret'").get().valor;
}
const app = await buildApp({ db, logger: true });
await app.listen({ port: config.port, host: config.host });

// Atualização automática do PNCP e alertas. Desligue com AGENDADOR=off.
if (process.env.AGENDADOR !== 'off') iniciarAgendador(db, { log: (m) => app.log.info(m), ia: clienteIA() });
