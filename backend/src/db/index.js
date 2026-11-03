import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  razao_social TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (usuario_id, cnpj)
);

-- Licitações importadas do PNCP (compartilhadas entre todos os usuários).
CREATE TABLE IF NOT EXISTS oportunidades (
  id INTEGER PRIMARY KEY,
  numero_controle_pncp TEXT NOT NULL UNIQUE,
  objeto TEXT NOT NULL,
  modalidade_id INTEGER,
  modalidade TEXT,
  modo_disputa TEXT,
  situacao TEXT,
  orgao_cnpj TEXT,
  orgao_nome TEXT,
  unidade_nome TEXT,
  uf TEXT,
  municipio TEXT,
  numero_compra TEXT,
  ano_compra INTEGER,
  sequencial_compra INTEGER,
  valor_estimado REAL,
  registro_preco INTEGER NOT NULL DEFAULT 0,
  data_publicacao TEXT,
  data_abertura TEXT,
  data_encerramento TEXT,
  link_origem TEXT,
  link_pncp TEXT,
  importado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_op_encerramento ON oportunidades(data_encerramento);
CREATE INDEX IF NOT EXISTS idx_op_uf ON oportunidades(uf);

CREATE VIRTUAL TABLE IF NOT EXISTS oportunidades_fts USING fts5(
  objeto, orgao_nome, unidade_nome, municipio,
  content='oportunidades', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS op_ai AFTER INSERT ON oportunidades BEGIN
  INSERT INTO oportunidades_fts(rowid, objeto, orgao_nome, unidade_nome, municipio)
  VALUES (new.id, new.objeto, new.orgao_nome, new.unidade_nome, new.municipio);
END;
CREATE TRIGGER IF NOT EXISTS op_ad AFTER DELETE ON oportunidades BEGIN
  INSERT INTO oportunidades_fts(oportunidades_fts, rowid, objeto, orgao_nome, unidade_nome, municipio)
  VALUES ('delete', old.id, old.objeto, old.orgao_nome, old.unidade_nome, old.municipio);
END;
CREATE TRIGGER IF NOT EXISTS op_au AFTER UPDATE ON oportunidades BEGIN
  INSERT INTO oportunidades_fts(oportunidades_fts, rowid, objeto, orgao_nome, unidade_nome, municipio)
  VALUES ('delete', old.id, old.objeto, old.orgao_nome, old.unidade_nome, old.municipio);
  INSERT INTO oportunidades_fts(rowid, objeto, orgao_nome, unidade_nome, municipio)
  VALUES (new.id, new.objeto, new.orgao_nome, new.unidade_nome, new.municipio);
END;

-- Funil: licitações que o usuário decidiu acompanhar.
CREATE TABLE IF NOT EXISTS negocios (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  oportunidade_id INTEGER REFERENCES oportunidades(id) ON DELETE SET NULL,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  etapa TEXT NOT NULL DEFAULT 'triagem'
    CHECK (etapa IN ('triagem','analise','proposta','disputa','ganho','perdido')),
  responsavel TEXT,
  valor_proposta REAL,
  data_disputa TEXT,
  notas TEXT,
  favorito INTEGER NOT NULL DEFAULT 0,
  arquivado INTEGER NOT NULL DEFAULT 0,
  posicao INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (usuario_id, oportunidade_id)
);

CREATE TABLE IF NOT EXISTS checklist_itens (
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  feito INTEGER NOT NULL DEFAULT 0,
  posicao INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'outros',
  validade TEXT,
  arquivo_nome TEXT,
  arquivo_path TEXT,
  arquivo_tamanho INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS negocio_documentos (
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  documento_id INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  PRIMARY KEY (negocio_id, documento_id)
);

-- Perfis de alerta: palavras-chave + filtros, enviados por e-mail.
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  palavras TEXT NOT NULL,
  ufs TEXT NOT NULL DEFAULT '[]',
  modalidades TEXT NOT NULL DEFAULT '[]',
  valor_min REAL,
  valor_max REAL,
  email_ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_envio TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id INTEGER REFERENCES negocios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  inicio TEXT NOT NULL,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS sincronizacoes (
  id INTEGER PRIMARY KEY,
  iniciado_em TEXT NOT NULL DEFAULT (datetime('now')),
  finalizado_em TEXT,
  importadas INTEGER NOT NULL DEFAULT 0,
  erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_op_municipio ON oportunidades(uf, municipio);

-- Arquivos do edital baixados do PNCP e enviados à Files API da Anthropic (compartilhados).
CREATE TABLE IF NOT EXISTS edital_arquivos (
  id INTEGER PRIMARY KEY,
  oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pdf','texto')),
  file_id TEXT NOT NULL,
  paginas INTEGER,
  tamanho INTEGER,
  expira_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edarq_op ON edital_arquivos(oportunidade_id);

-- Arquivos que não puderam ser lidos (formato, tamanho), para avisar o usuário.
CREATE TABLE IF NOT EXISTS edital_ignorados (
  oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  motivo TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edital_resumos (
  oportunidade_id INTEGER PRIMARY KEY REFERENCES oportunidades(id) ON DELETE CASCADE,
  resumo TEXT NOT NULL,
  modelo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS edital_perguntas (
  id INTEGER PRIMARY KEY,
  oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  citacoes TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_edperg ON edital_perguntas(oportunidade_id, usuario_id);

-- Última execução de tarefas agendadas (alertas diários etc.).
CREATE TABLE IF NOT EXISTS tarefas (
  nome TEXT PRIMARY KEY,
  ultima_execucao TEXT NOT NULL
);

-- Registro de uso da IA (limite diário por usuário).
CREATE TABLE IF NOT EXISTS ia_uso (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Colunas adicionadas depois da primeira versão (bancos já existentes).
const MIGRACOES = [
  "ALTER TABLE alertas ADD COLUMN municipios TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE sincronizacoes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'completa'",
];

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const m of MIGRACOES) {
    try { db.exec(m); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
  return db;
}

/** Executa fn dentro de uma transação. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
