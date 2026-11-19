import { hashSenha, conferirSenha, criarToken } from '../services/auth.js';
import { httpError, COOKIE } from '../http.js';
import { config } from '../config.js';

const cookieOpts = () => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: config.sessionDays * 86400,
});

// Proteção contra adivinhar senha: no máximo 5 erros em 15 minutos por e-mail e 20 por endereço de internet (IP).
const JANELA_MS = 15 * 60 * 1000;
const erros = new Map(); // chave -> lista de horários dos erros
function contar(chave, agora) {
  const lista = (erros.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
  erros.set(chave, lista);
  return lista;
}
export function _limparTentativas() { erros.clear(); }

export default async function (app) {
  const { db } = app;

  app.post('/cadastro', {
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'email', 'senha'],
        properties: {
          nome: { type: 'string', minLength: 2, maxLength: 120 },
          email: { type: 'string', format: 'email', maxLength: 200 },
          senha: { type: 'string', minLength: 8, maxLength: 200 },
          convite: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { nome, email, senha, convite } = req.body;
    // Em produção o cadastro fica fechado depois da primeira conta (a do dono),
    // a não ser que haja código de convite ou CADASTRO_ABERTO=true.
    const temUsuarios = !!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
    const codigo = process.env.CODIGO_CONVITE;
    const aberto = process.env.CADASTRO_ABERTO === 'true' || (process.env.NODE_ENV !== 'production' && !codigo);
    if (temUsuarios && !aberto) {
      if (!codigo) throw httpError(403, 'O cadastro de novas contas está fechado. Peça acesso ao administrador.');
      if (convite?.trim() !== codigo) throw httpError(403, 'Código de convite inválido.');
    }
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
      throw httpError(409, 'Já existe uma conta com este e-mail.');
    }
    const u = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?) RETURNING id, nome, email')
      .get(nome.trim(), email.trim(), hashSenha(senha));
    reply.setCookie(COOKIE, criarToken(u.id), cookieOpts());
    return u;
  });

  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'senha'],
        properties: { email: { type: 'string' }, senha: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const agora = Date.now();
    const email = req.body.email.trim().toLowerCase();
    const chaves = [`e:${email}`, `ip:${req.ip}`];
    if (contar(chaves[0], agora).length >= 5 || contar(chaves[1], agora).length >= 20) {
      throw httpError(429, 'Muitas tentativas de login erradas. Por segurança, espere 15 minutos e tente de novo.');
    }
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? COLLATE NOCASE').get(req.body.email.trim());
    if (!u || !conferirSenha(req.body.senha, u.senha_hash)) {
      for (const c of chaves) contar(c, agora).push(agora);
      throw httpError(401, 'E-mail ou senha incorretos.');
    }
    erros.delete(chaves[0]);
    reply.setCookie(COOKIE, criarToken(u.id), cookieOpts());
    return { id: u.id, nome: u.nome, email: u.email };
  });

  app.post('/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.put('/senha', {
    schema: {
      body: {
        type: 'object',
        required: ['atual', 'nova'],
        properties: { atual: { type: 'string' }, nova: { type: 'string', minLength: 8, maxLength: 200 } },
      },
    },
  }, async (req) => {
    if (!req.usuarioId) throw httpError(401, 'Faça login para continuar.');
    const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (!u || !conferirSenha(req.body.atual, u.senha_hash)) throw httpError(400, 'A senha atual está incorreta.');
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(req.body.nova), req.usuarioId);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    if (!req.usuarioId) throw httpError(401, 'Não autenticado.');
    const u = db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (!u) throw httpError(401, 'Não autenticado.');
    return u;
  });
}
