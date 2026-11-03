import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from '../config.js';

export function hashSenha(senha) {
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function conferirSenha(senha, armazenado) {
  const [alg, saltB64, hashB64] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtido = scryptSync(senha, Buffer.from(saltB64, 'base64'), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

function assinar(payload) {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function criarToken(usuarioId) {
  const exp = Date.now() + config.sessionDays * 86400000;
  const payload = Buffer.from(JSON.stringify({ uid: usuarioId, exp })).toString('base64url');
  return `${payload}.${assinar(payload)}`;
}

export function lerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return null;
  const esperado = Buffer.from(assinar(payload));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}
