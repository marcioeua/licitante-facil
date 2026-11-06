import { httpError, idParam } from '../http.js';

export function limparCnpj(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** Valida CNPJ numérico (14 dígitos) pelos dígitos verificadores. */
export function cnpjValido(v) {
  const c = limparCnpj(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const d of base) {
      soma += Number(d) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

const body = {
  type: 'object',
  required: ['razao_social', 'cnpj'],
  properties: {
    razao_social: { type: 'string', minLength: 2, maxLength: 300 },
    cnpj: { type: 'string', maxLength: 20 },
  },
};

export default async function (app) {
  const { db } = app;

  app.get('/', async (req) =>
    db.prepare('SELECT * FROM empresas WHERE usuario_id = ? ORDER BY razao_social').all(req.usuarioId));

  app.post('/', { schema: { body } }, async (req, reply) => {
    const cnpj = limparCnpj(req.body.cnpj);
    if (!cnpjValido(cnpj)) throw httpError(400, 'CNPJ inválido.');
    if (db.prepare('SELECT 1 FROM empresas WHERE usuario_id = ? AND cnpj = ?').get(req.usuarioId, cnpj)) {
      throw httpError(409, 'Empresa já cadastrada.');
    }
    reply.code(201);
    return db.prepare('INSERT INTO empresas (usuario_id, razao_social, cnpj) VALUES (?, ?, ?) RETURNING *')
      .get(req.usuarioId, req.body.razao_social.trim(), cnpj);
  });

  app.put('/:id', { schema: { body } }, async (req) => {
    const cnpj = limparCnpj(req.body.cnpj);
    if (!cnpjValido(cnpj)) throw httpError(400, 'CNPJ inválido.');
    const e = db.prepare('UPDATE empresas SET razao_social = ?, cnpj = ? WHERE id = ? AND usuario_id = ? RETURNING *')
      .get(req.body.razao_social.trim(), cnpj, idParam(req.params.id), req.usuarioId);
    if (!e) throw httpError(404, 'Empresa não encontrada.');
    return e;
  });

  // Dados usados na proposta de preços (endereço, representante, banco etc.).
  const texto = (max) => ({ type: ['string', 'null'], maxLength: max });
  app.patch('/:id/dados', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
      endereco: texto(300), representante: texto(150), representante_cpf: texto(20), representante_cargo: texto(80),
      telefone: texto(40), email: texto(150), banco: texto(300),
    } } },
  }, async (req) => {
    const campos = Object.keys(req.body);
    const e = db.prepare(`UPDATE empresas SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND usuario_id = ? RETURNING *`)
      .get(...campos.map((c) => (typeof req.body[c] === 'string' ? req.body[c].trim() || null : null)), idParam(req.params.id), req.usuarioId);
    if (!e) throw httpError(404, 'Empresa não encontrada.');
    return e;
  });

  app.delete('/:id', async (req) => {
    const r = db.prepare('DELETE FROM empresas WHERE id = ? AND usuario_id = ?').run(idParam(req.params.id), req.usuarioId);
    if (!r.changes) throw httpError(404, 'Empresa não encontrada.');
    return { ok: true };
  });
}
