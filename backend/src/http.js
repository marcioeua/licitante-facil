/** Erro HTTP com status, tratado pelo error handler do app. */
export function httpError(status, message) {
  return Object.assign(new Error(message), { statusCode: status, expose: true });
}

export function idParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'Identificador inválido.');
  return n;
}

export const COOKIE = 'lf_sess';
