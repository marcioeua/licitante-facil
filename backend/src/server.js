import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { buildApp } from './app.js';

const db = openDatabase(config.dbPath);
const app = await buildApp({ db, logger: true });
await app.listen({ port: config.port, host: config.host });
