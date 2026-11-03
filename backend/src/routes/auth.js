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
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(req.body.email.trim());
    if (!u || !conferirSenha(req.body.senha, u.senha_hash)) {
      throw httpError(401, 'E-mail ou senha incorretos.');
    }
    reply.setCookie(COOKIE, criarToken(u.id), cookieOpts());
    return { id: u.id, nome: u.nome, email: u.email };
  });

  app.post('/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    if (!req.usuarioId) throw httpError(401, 'Não autenticado.');
    const u = db.prepare('SELECT id, nome, email FROM usuarios WHERE id = ?').get(req.usuarioId);
    if (!u) throw httpError(401, 'Não autenticado.');
    return u;
  });
}
