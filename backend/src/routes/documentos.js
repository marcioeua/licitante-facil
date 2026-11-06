import { createWriteStream, createReadStream, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import { config } from '../config.js';
import { httpError, idParam } from '../http.js';

export const CATEGORIAS = [
  'certidao_federal', 'certidao_estadual', 'certidao_municipal', 'fgts', 'trabalhista',
  'contrato_social', 'balanco', 'atestado_tecnico', 'procuracao', 'falencia', 'cnpj', 'alvara',
  'registro_conselho', 'documentos_socios', 'outros',
];

const EXT_PERMITIDAS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.xls', '.xlsx', '.odt', '.zip']);

function statusValidade(validade) {
  if (!validade) return 'sem_validade';
  const dias = Math.floor((new Date(validade + 'T23:59:59') - Date.now()) / 86400000);
  if (dias < 0) return 'vencido';
  if (dias <= 15) return 'vencendo';
  return 'valido';
}

export default async function (app) {
  const { db } = app;
  mkdirSync(config.uploadDir, { recursive: true });

  const doUsuario = (uid, id) => {
    const d = db.prepare('SELECT * FROM documentos WHERE id = ? AND usuario_id = ?').get(id, uid);
    if (!d) throw httpError(404, 'Documento não encontrado.');
    return d;
  };
  const publico = ({ arquivo_path, ...d }) => ({ ...d, status: statusValidade(d.validade) });

  app.get('/', async (req) => {
    const params = [req.usuarioId];
    let filtro = '';
    if (req.query.empresa_id) {
      filtro = 'AND d.empresa_id = ?';
      params.push(Number(req.query.empresa_id));
    }
    return db.prepare(`
      SELECT d.*, e.razao_social AS empresa_nome FROM documentos d
      LEFT JOIN empresas e ON e.id = d.empresa_id
      WHERE d.usuario_id = ? ${filtro}
      ORDER BY d.validade IS NULL, d.validade, d.nome`).all(...params).map(publico);
  });

  app.get('/categorias', async () => CATEGORIAS);

  // Upload multipart: campos nome, categoria, validade, empresa_id + arquivo (opcional).
  app.post('/', async (req, reply) => {
    const uid = req.usuarioId;
    const campos = {};
    let arquivo = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const ext = extname(part.filename).toLowerCase();
        if (!EXT_PERMITIDAS.has(ext)) {
          part.file.resume();
          throw httpError(400, 'Tipo de arquivo não permitido.');
        }
        const nomeDisco = `${randomUUID()}${ext}`;
        const destino = join(config.uploadDir, nomeDisco);
        await pipeline(part.file, createWriteStream(destino));
        if (part.file.truncated) {
          unlinkSync(destino);
          throw httpError(413, 'Arquivo maior que 25 MB.');
        }
        arquivo = { nome: part.filename, path: nomeDisco, tamanho: part.file.bytesRead };
      } else {
        campos[part.fieldname] = part.value;
      }
    }
    const nome = String(campos.nome ?? arquivo?.nome ?? '').trim().slice(0, 300);
    if (!nome) throw httpError(400, 'Informe o nome do documento.');
    const categoria = CATEGORIAS.includes(campos.categoria) ? campos.categoria : 'outros';
    const validade = /^\d{4}-\d{2}-\d{2}$/.test(campos.validade ?? '') ? campos.validade : null;
    const empresaId = campos.empresa_id ? Number(campos.empresa_id) : null;
    if (empresaId && !db.prepare('SELECT 1 FROM empresas WHERE id = ? AND usuario_id = ?').get(empresaId, uid)) {
      throw httpError(400, 'Empresa inválida.');
    }
    const d = db.prepare(`
      INSERT INTO documentos (usuario_id, empresa_id, nome, categoria, validade, arquivo_nome, arquivo_path, arquivo_tamanho)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(
      uid, empresaId, nome, categoria, validade, arquivo?.nome ?? null, arquivo?.path ?? null, arquivo?.tamanho ?? null,
    );
    reply.code(201);
    return publico(d);
  });

  app.patch('/:id', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nome: { type: 'string', minLength: 1, maxLength: 300 },
          categoria: { type: 'string', enum: CATEGORIAS },
          validade: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          empresa_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (req) => {
    const id = idParam(req.params.id);
    doUsuario(req.usuarioId, id);
    const campos = Object.keys(req.body);
    if (campos.length) {
      db.prepare(`UPDATE documentos SET ${campos.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`).run({ ...req.body, id });
    }
    return publico(doUsuario(req.usuarioId, id));
  });

  app.get('/:id/arquivo', async (req, reply) => {
    const d = doUsuario(req.usuarioId, idParam(req.params.id));
    const caminho = d.arquivo_path && join(config.uploadDir, d.arquivo_path);
    if (!caminho || !existsSync(caminho)) throw httpError(404, 'Este documento não tem arquivo.');
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.arquivo_nome)}`);
    reply.type('application/octet-stream');
    return reply.send(createReadStream(caminho));
  });

  app.delete('/:id', async (req) => {
    const d = doUsuario(req.usuarioId, idParam(req.params.id));
    db.prepare('DELETE FROM documentos WHERE id = ?').run(d.id);
    if (d.arquivo_path) {
      try { unlinkSync(join(config.uploadDir, d.arquivo_path)); } catch { /* já removido */ }
    }
    return { ok: true };
  });
}
