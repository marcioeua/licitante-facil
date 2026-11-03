// Importa licitações com propostas abertas do PNCP. Agende a cada 1–3 horas (cron).
import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { sincronizarPropostasAbertas } from '../services/pncp.js';

const db = openDatabase(config.dbPath);
try {
  const r = await sincronizarPropostasAbertas(db);
  console.log(`Sincronização concluída: ${r.importadas} oportunidades importadas/atualizadas.`);
} catch (e) {
  console.error('Falha na sincronização com o PNCP:', e.message);
  process.exitCode = 1;
}
