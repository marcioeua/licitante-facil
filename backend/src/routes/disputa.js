import { httpError, idParam } from '../http.js';
import { montarItem, importarItens } from '../services/disputa.js';
import { pesquisarPrecos } from '../services/historico.js';
import { tituloItem } from '../services/vitorias.js';
import { analisarChat, historicoChat, MAX_TEXTO } from '../services/pregoeiro.js';
import { fornecedoresDoItem, contatoFornecedor } from '../services/fornecedores.js';

const num = { type: ['number', 'null'], minimum: 0 };
const itemProps = {
  numero_item: { type: ['integer', 'null'] },
  descricao: { type: 'string', minLength: 1, maxLength: 2000 },
  unidade: { type: ['string', 'null'], maxLength: 60 },
  quantidade: num,
  valor_estimado: num,
  custo: num,
  margem_minima: { type: ['number', 'null'], minimum: -0.5, maximum: 10 },
  lance_inicial: num,
  decremento: num,
  decremento_tipo: { type: 'string', enum: ['valor', 'pct'] },
  melhor_lance: num,
  meu_lance: num,
  situacao: { type: 'string', enum: ['pendente', 'disputando', 'ganho', 'perdido', 'desisti'] },
  notas: { type: ['string', 'null'], maxLength: 5000 },
  marca: { type: ['string', 'null'], maxLength: 300 },
};

export default async function (app) {
  const { db } = app;

  const negocio = (uid, id) => {
    const n = db.prepare(`SELECT n.id, n.titulo, n.etapa, n.data_disputa, n.oportunidade_id, n.empresa_id, o.numero_controle_pncp, o.objeto, o.orgao_nome,
        o.unidade_nome, o.uf, o.municipio, o.modalidade, o.numero_compra, o.ano_compra, o.data_abertura, o.data_encerramento, o.link_origem, o.link_pncp, o.valor_estimado, e.razao_social AS empresa, e.cnpj AS empresa_cnpj, e.endereco AS empresa_endereco,
        e.representante AS empresa_representante, e.representante_cpf AS empresa_representante_cpf, e.representante_cargo AS empresa_representante_cargo,
        e.telefone AS empresa_telefone, e.email AS empresa_email, e.banco AS empresa_banco
      FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id LEFT JOIN empresas e ON e.id = n.empresa_id WHERE n.id = ? AND n.usuario_id = ?`).get(idParam(id), uid);
    if (!n) throw httpError(404, 'Negócio não encontrado.');
    return n;
  };
  const item = (uid, id) => {
    const it = db.prepare(`SELECT i.* FROM disputa_itens i JOIN negocios n ON n.id = i.negocio_id
      WHERE i.id = ? AND n.usuario_id = ?`).get(idParam(id), uid);
    if (!it) throw httpError(404, 'Item não encontrado.');
    return it;
  };
  const recarregar = (id) => montarItem(db, db.prepare('SELECT * FROM disputa_itens WHERE id = ?').get(id));

  app.get('/negocio/:id', async (req) => {
    const n = negocio(req.usuarioId, req.params.id);
    const itens = db.prepare('SELECT * FROM disputa_itens WHERE negocio_id = ? ORDER BY numero_item IS NULL, numero_item, id').all(n.id)
      .map((i) => montarItem(db, i));
    // Do edital lido pela IA: dados que entram na proposta.
    const r = n.oportunidade_id ? db.prepare('SELECT resumo FROM edital_resumos WHERE oportunidade_id = ?').get(n.oportunidade_id) : null;
    const s = r ? JSON.parse(r.resumo) : null;
    const edital = s ? { prazo_entrega: s.prazo_entrega_execucao, pagamento: s.condicoes_pagamento, vigencia: s.vigencia, requisitos_proposta: s.requisitos_proposta ?? [] } : null;
    return { negocio: n, itens, edital };
  });

  app.post('/negocio/:id/importar', async (req) => {
    const n = negocio(req.usuarioId, req.params.id);
    return importarItens(db, n, { fetchImpl: app.fetchPncp });
  });

  app.post('/negocio/:id/itens', { schema: { body: { type: 'object', required: ['descricao'], properties: itemProps, additionalProperties: false } } }, async (req, reply) => {
    const n = negocio(req.usuarioId, req.params.id);
    const campos = Object.keys(req.body);
    const r = db.prepare(`INSERT INTO disputa_itens (negocio_id, ${campos.join(', ')}) VALUES (?, ${campos.map(() => '?').join(', ')}) RETURNING id`)
      .get(n.id, ...campos.map((c) => req.body[c]));
    return reply.code(201).send(recarregar(r.id));
  });

  app.patch('/itens/:id', { schema: { body: { type: 'object', properties: itemProps, additionalProperties: false, minProperties: 1 } } }, async (req) => {
    const it = item(req.usuarioId, req.params.id);
    const campos = Object.keys(req.body);
    db.prepare(`UPDATE disputa_itens SET ${campos.map((c) => `${c} = ?`).join(', ')}, atualizado_em = datetime('now') WHERE id = ?`)
      .run(...campos.map((c) => req.body[c]), it.id);
    return recarregar(it.id);
  });

  app.delete('/itens/:id', async (req) => {
    const it = item(req.usuarioId, req.params.id);
    db.prepare('DELETE FROM disputa_itens WHERE id = ?').run(it.id);
    return { ok: true };
  });

  // Registra o melhor lance da sala ou o lance que o usuário deu no portal.
  app.post('/itens/:id/lances', {
    schema: { body: { type: 'object', required: ['tipo', 'valor'], properties: { tipo: { type: 'string', enum: ['meu', 'melhor'] }, valor: { type: 'number', exclusiveMinimum: 0 } } } },
  }, async (req) => {
    const it = item(req.usuarioId, req.params.id);
    const { tipo, valor } = req.body;
    db.prepare('INSERT INTO disputa_lances (item_id, tipo, valor) VALUES (?, ?, ?)').run(it.id, tipo, valor);
    // Quando o usuário dá um lance, ele passa a ser o melhor se for menor.
    const melhor = tipo === 'melhor' ? valor : Math.min(valor, it.melhor_lance ?? Infinity);
    db.prepare(`UPDATE disputa_itens SET meu_lance = CASE WHEN :tipo = 'meu' THEN :v ELSE meu_lance END, melhor_lance = :m,
      situacao = CASE WHEN situacao = 'pendente' THEN 'disputando' ELSE situacao END, atualizado_em = datetime('now') WHERE id = :id`)
      .run({ tipo, v: valor, m: melhor, id: it.id });
    return recarregar(it.id);
  });

  // Desfaz o último registro (erro de digitação na hora da disputa).
  app.delete('/itens/:id/lances/ultimo', async (req) => {
    const it = item(req.usuarioId, req.params.id);
    const ult = db.prepare('SELECT id FROM disputa_lances WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(it.id);
    if (ult) db.prepare('DELETE FROM disputa_lances WHERE id = ?').run(ult.id);
    const ultimo = (tipo) => db.prepare('SELECT valor FROM disputa_lances WHERE item_id = ? AND tipo = ? ORDER BY id DESC LIMIT 1').get(it.id, tipo)?.valor ?? null;
    const meu = ultimo('meu');
    const melhorSala = ultimo('melhor');
    const melhor = [meu, melhorSala].filter((v) => v != null);
    db.prepare("UPDATE disputa_itens SET meu_lance = ?, melhor_lance = ?, atualizado_em = datetime('now') WHERE id = ?")
      .run(meu, melhor.length ? Math.min(...melhor) : null, it.id);
    return recarregar(it.id);
  });

  // Preços pagos em compras públicas parecidas (itens homologados no PNCP).
  app.get('/itens/:id/precos', async (req, reply) => {
    const it = item(req.usuarioId, req.params.id);
    const q = String(req.query.q ?? tituloItem(it.descricao) ?? it.descricao).slice(0, 120);
    try {
      const r = await pesquisarPrecos(db, { q }, { fetchImpl: app.fetchPncp, maxCompras: 8 });
      return { q, grupos: r.grupos, itens: r.itens.slice(0, 15) };
    } catch (e) {
      req.log.warn(e);
      return reply.code(502).send({ erro: 'Não foi possível consultar os preços agora. Tente novamente.' });
    }
  });

  // Leitor do chat do pregoeiro (texto colado pelo usuário; nada é lido do portal).
  app.get('/negocio/:id/chat', async (req) => {
    const n = negocio(req.usuarioId, req.params.id);
    return { iaDisponivel: !!app.ia, analises: historicoChat(db, n.id) };
  });
  app.post('/negocio/:id/chat', {
    schema: { body: { type: 'object', required: ['texto'], properties: { texto: { type: 'string', maxLength: MAX_TEXTO + 1000 } } } },
  }, async (req) => {
    const n = negocio(req.usuarioId, req.params.id);
    return analisarChat(db, n.id, req.usuarioId, req.body.texto, { client: app.ia });
  });
  app.delete('/chat/:id', async (req) => {
    const r = db.prepare(`DELETE FROM disputa_mensagens WHERE id = ? AND negocio_id IN (SELECT id FROM negocios WHERE usuario_id = ?)`)
      .run(idParam(req.params.id), req.usuarioId);
    if (!r.changes) throw httpError(404, 'Análise não encontrada.');
    return { ok: true };
  });

  // Agente Fornecedor: quem vendeu itens parecidos ao governo (PNCP) e contato público (Receita).
  app.get('/itens/:id/fornecedores', async (req, reply) => {
    const it = item(req.usuarioId, req.params.id);
    const n = db.prepare('SELECT o.uf, coalesce(o.objeto, n.titulo) AS objeto FROM negocios n LEFT JOIN oportunidades o ON o.id = n.oportunidade_id WHERE n.id = ?').get(it.negocio_id);
    try {
      return await fornecedoresDoItem(db, it.descricao, { q: req.query.q, uf: n?.uf, objeto: n?.objeto, fetchImpl: app.fetchPncp });
    } catch (e) {
      req.log.warn(e);
      return reply.code(502).send({ erro: 'Não foi possível consultar o PNCP agora. Tente novamente em instantes.' });
    }
  });
  // Busca livre por produto (funciona mesmo sem itens na sala).
  app.get('/negocio/:id/fornecedores', async (req, reply) => {
    const n = negocio(req.usuarioId, req.params.id);
    const q = String(req.query.q ?? '').trim();
    if (q.length < 3) return reply.code(400).send({ erro: 'Digite pelo menos 3 letras do produto.' });
    try {
      // O assunto da licitação só ajuda quando o produto digitado é do mesmo assunto; senão, usa o próprio texto.
      const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const objeto = n.objeto ?? n.titulo;
      const mesmoAssunto = norm(q).split(/\s+/).some((w) => w.length >= 4 && norm(objeto).includes(w.slice(0, 5)));
      return await fornecedoresDoItem(db, q, { uf: n.uf, objeto: mesmoAssunto ? objeto : `material ${q}`, fetchImpl: app.fetchPncp });
    } catch (e) {
      req.log.warn(e);
      return reply.code(502).send({ erro: 'Não foi possível consultar o PNCP agora. Tente novamente em instantes.' });
    }
  });
  app.get('/fornecedores/:ni/contato', async (req, reply) => {
    const ni = String(req.params.ni).replace(/\D/g, '');
    if (ni.length !== 14) return reply.code(400).send({ erro: 'CNPJ inválido.' });
    const c = await contatoFornecedor(db, ni, { fetchImpl: app.fetchCnpj });
    return c ?? reply.code(404).send({ erro: 'Cadastro não encontrado agora. Tente de novo mais tarde.' });
  });
}
