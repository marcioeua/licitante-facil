// Envia por e-mail as oportunidades novas de cada alerta. Agende 1x por dia (cron).
import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { enviarAlertas } from '../services/alertas.js';

const db = openDatabase(config.dbPath);
const r = await enviarAlertas(db);
console.log(`Alertas: ${r.enviados} e-mails enviados, ${r.semNovidade} sem novidades.`);
