// Redefine a senha de um usuário e mostra uma senha provisória.
// Uso (no Console do Railway): node src/redefinir-senha.js email@exemplo.com
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// O banco pertence ao usuário "node"; rodando como root, os arquivos do SQLite
// ficariam com o dono errado e a aplicação pararia de gravar.
if (process.getuid?.() === 0 && spawnSync('id', ['node']).status === 0) {
  const r = spawnSync('setpriv', ['--reuid=node', '--regid=node', '--init-groups', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { openDatabase } = await import('./db/index.js');
const { config } = await import('./config.js');
const { hashSenha } = await import('./services/auth.js');

const email = String(process.argv[2] ?? '').trim();
const db = openDatabase(config.dbPath);
if (!email) {
  console.log('Informe o e-mail. Contas cadastradas:');
  for (const u of db.prepare('SELECT nome, email FROM usuarios ORDER BY id').all()) console.log(`  ${u.email}  (${u.nome})`);
  process.exit(1);
}
const u = db.prepare('SELECT id, nome FROM usuarios WHERE lower(email) = lower(?)').get(email);
if (!u) {
  console.log(`Nenhuma conta com o e-mail ${email}. Rode sem e-mail para ver a lista.`);
  process.exit(1);
}
const provisoria = randomBytes(9).toString('base64url');
db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(provisoria), u.id);
console.log(`\nSenha de ${u.nome} redefinida.\nSenha provisória: ${provisoria}\nEntre com ela e troque em: seu nome (canto superior direito) → Alterar senha.\n`);
