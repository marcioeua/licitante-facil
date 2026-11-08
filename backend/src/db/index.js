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

CREATE TABLE IF NOT EXISTS disputa_itens (
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero_item INTEGER,
  descricao TEXT NOT NULL,
  unidade TEXT,
  quantidade REAL,
  valor_estimado REAL,
  custo REAL,
  margem_minima REAL,
  lance_inicial REAL,
  decremento REAL,
  decremento_tipo TEXT NOT NULL DEFAULT 'valor' CHECK (decremento_tipo IN ('valor', 'pct')),
  melhor_lance REAL,
  meu_lance REAL,
  situacao TEXT NOT NULL DEFAULT 'pendente'
    CHECK (situacao IN ('pendente', 'disputando', 'ganho', 'perdido', 'desisti')),
  notas TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_disputa_negocio ON disputa_itens(negocio_id, numero_item);
CREATE TABLE IF NOT EXISTS disputa_lances (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES disputa_itens(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('meu', 'melhor')),
  valor REAL NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS disputa_mensagens (
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  analise TEXT NOT NULL,
  lembretes INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pecas_juridicas (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  negocio_id INTEGER REFERENCES negocios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('analise', 'esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes')),
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  dados TEXT NOT NULL DEFAULT '{}',
  modelo TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pecas_usuario ON pecas_juridicas(usuario_id, negocio_id);

-- Envios de edital pelo WhatsApp (fila: o PDF é baixado do PNCP e enviado pela API oficial da Meta).
CREATE TABLE IF NOT EXISTS whatsapp_fila (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  origem TEXT NOT NULL DEFAULT 'manual',
  tentativas INTEGER NOT NULL DEFAULT 0,
  enviado_em TEXT,
  resultado TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Limite de gasto mensal com IA e cotação do dólar (por usuário).
CREATE TABLE IF NOT EXISTS ia_config (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  limite_mensal_usd REAL,
  cotacao_dolar REAL
);

-- Assistente de IA dentro do sistema: conversas e mensagens (formato da API, com blocos de ferramenta).
CREATE TABLE IF NOT EXISTS assistente_conversas (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assistente_mensagens (
  id INTEGER PRIMARY KEY,
  conversa_id INTEGER NOT NULL REFERENCES assistente_conversas(id) ON DELETE CASCADE,
  papel TEXT NOT NULL CHECK (papel IN ('user', 'assistant')),
  conteudo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assist_msg ON assistente_mensagens(conversa_id, id);

-- Órgãos públicos (resumo dos últimos 12 meses), recalculado todo dia a partir de contratos e licitações.
CREATE TABLE IF NOT EXISTS orgaos (
  cnpj TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  nome_norm TEXT,
  esfera TEXT,
  uf TEXT,
  municipio TEXT,
  codigo_ibge TEXT,
  contratos_12m INTEGER NOT NULL DEFAULT 0,
  valor_12m REAL NOT NULL DEFAULT 0,
  licitacoes_12m INTEGER NOT NULL DEFAULT 0,
  ultima_compra TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orgaos_uf ON orgaos(uf, esfera);
CREATE INDEX IF NOT EXISTS idx_op_orgao ON oportunidades(orgao_cnpj);

CREATE TABLE IF NOT EXISTS conector_tokens (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_uso TEXT,
  chamadas INTEGER NOT NULL DEFAULT 0
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

-- CAPAG (capacidade de pagamento) de estados e municípios, do Tesouro Transparente.
CREATE TABLE IF NOT EXISTS capag_entes (
  tipo TEXT NOT NULL CHECK (tipo IN ('estado','municipio')),
  codigo TEXT NOT NULL,           -- UF (estado) ou código IBGE de 7 dígitos (município)
  nome TEXT NOT NULL,
  nome_norm TEXT NOT NULL,
  uf TEXT NOT NULL,
  capag TEXT,
  ind1 REAL, nota1 TEXT,
  ind2 REAL, nota2 TEXT,
  ind3 REAL, nota3 TEXT,
  icf TEXT,
  referencia TEXT,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (tipo, codigo)
);
CREATE INDEX IF NOT EXISTS idx_capag_nome ON capag_entes(nome_norm);

-- Histórico de compras: contratos publicados no PNCP (últimos HISTORICO_DIAS dias).
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY,
  numero_controle_pncp TEXT NOT NULL UNIQUE,
  compra_controle TEXT,
  objeto TEXT NOT NULL,
  categoria TEXT, tipo TEXT,
  valor_global REAL,
  fornecedor_ni TEXT, fornecedor_nome TEXT,
  orgao_cnpj TEXT, orgao_nome TEXT, esfera TEXT, unidade_nome TEXT,
  uf TEXT, municipio TEXT, codigo_ibge TEXT,
  data_assinatura TEXT, data_publicacao TEXT
);
CREATE INDEX IF NOT EXISTS idx_ct_compra ON contratos(compra_controle);
CREATE INDEX IF NOT EXISTS idx_ct_forn ON contratos(fornecedor_ni);
CREATE INDEX IF NOT EXISTS idx_ct_orgao ON contratos(orgao_cnpj);
CREATE INDEX IF NOT EXISTS idx_ct_pub ON contratos(data_publicacao);
CREATE INDEX IF NOT EXISTS idx_ct_uf ON contratos(uf, data_publicacao);
CREATE VIRTUAL TABLE IF NOT EXISTS contratos_fts USING fts5(
  objeto, fornecedor_nome, orgao_nome, content='contratos', content_rowid='id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS ct_ai AFTER INSERT ON contratos BEGIN
  INSERT INTO contratos_fts(rowid, objeto, fornecedor_nome, orgao_nome) VALUES (new.id, new.objeto, new.fornecedor_nome, new.orgao_nome);
END;
CREATE TRIGGER IF NOT EXISTS ct_ad AFTER DELETE ON contratos BEGIN
  INSERT INTO contratos_fts(contratos_fts, rowid, objeto, fornecedor_nome, orgao_nome) VALUES ('delete', old.id, old.objeto, old.fornecedor_nome, old.orgao_nome);
END;
CREATE TRIGGER IF NOT EXISTS ct_au AFTER UPDATE ON contratos BEGIN
  INSERT INTO contratos_fts(contratos_fts, rowid, objeto, fornecedor_nome, orgao_nome) VALUES ('delete', old.id, old.objeto, old.fornecedor_nome, old.orgao_nome);
  INSERT INTO contratos_fts(rowid, objeto, fornecedor_nome, orgao_nome) VALUES (new.id, new.objeto, new.fornecedor_nome, new.orgao_nome);
END;
CREATE TABLE IF NOT EXISTS contratos_dias (dia TEXT PRIMARY KEY, importados INTEGER NOT NULL, importado_em TEXT NOT NULL);

-- Itens das compras e preços homologados (buscados sob demanda na pesquisa de preços).
CREATE TABLE IF NOT EXISTS compra_itens (
  id INTEGER PRIMARY KEY,
  compra_controle TEXT NOT NULL,
  numero_item INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  unidade TEXT, quantidade REAL, valor_unit_estimado REAL,
  tem_resultado INTEGER NOT NULL DEFAULT 0,
  resultado_buscado INTEGER NOT NULL DEFAULT 0,
  UNIQUE (compra_controle, numero_item)
);
CREATE VIRTUAL TABLE IF NOT EXISTS compra_itens_fts USING fts5(
  descricao, content='compra_itens', content_rowid='id', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS ci_ai AFTER INSERT ON compra_itens BEGIN
  INSERT INTO compra_itens_fts(rowid, descricao) VALUES (new.id, new.descricao);
END;
CREATE TRIGGER IF NOT EXISTS ci_ad AFTER DELETE ON compra_itens BEGIN
  INSERT INTO compra_itens_fts(compra_itens_fts, rowid, descricao) VALUES ('delete', old.id, old.descricao);
END;
CREATE TRIGGER IF NOT EXISTS ci_au AFTER UPDATE OF descricao ON compra_itens BEGIN
  INSERT INTO compra_itens_fts(compra_itens_fts, rowid, descricao) VALUES ('delete', old.id, old.descricao);
  INSERT INTO compra_itens_fts(rowid, descricao) VALUES (new.id, new.descricao);
END;
CREATE TABLE IF NOT EXISTS item_resultados (
  compra_controle TEXT NOT NULL,
  numero_item INTEGER NOT NULL,
  sequencial INTEGER NOT NULL,
  fornecedor_ni TEXT, fornecedor_nome TEXT, porte TEXT,
  quantidade REAL, valor_unitario REAL, valor_total REAL, data_resultado TEXT,
  PRIMARY KEY (compra_controle, numero_item, sequencial)
);
CREATE TABLE IF NOT EXISTS compras_consultadas (compra_controle TEXT PRIMARY KEY, consultado_em TEXT NOT NULL);

-- Agentes: configuração por usuário.
CREATE TABLE IF NOT EXISTS agentes_config (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  agente TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  ultima_execucao TEXT,
  ultimo_resultado TEXT,
  PRIMARY KEY (usuario_id, agente)
);

-- Notificações (sino no topo da tela e e-mail opcional).
CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  agente TEXT NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT,
  negocio_id INTEGER REFERENCES negocios(id) ON DELETE SET NULL,
  oportunidade_id INTEGER REFERENCES oportunidades(id) ON DELETE SET NULL,
  link TEXT,
  lida INTEGER NOT NULL DEFAULT 0,
  enviada_email INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificacoes(usuario_id, lida, criado_em);

-- Agente Vigia: última foto de cada licitação do funil, para detectar mudanças.
CREATE TABLE IF NOT EXISTS vigia_snapshot (
  negocio_id INTEGER PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
  dados TEXT NOT NULL,
  arquivos TEXT,
  verificado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dados cadastrais públicos de CNPJ (BrasilAPI), guardados por 30 dias.
CREATE TABLE IF NOT EXISTS empresas_cadastro (cnpj TEXT PRIMARY KEY, dados TEXT NOT NULL, atualizado_em TEXT NOT NULL);

-- Vitórias por fornecedor (Compras.gov.br Dados Abertos), por janela de 365 dias.
CREATE TABLE IF NOT EXISTS vitorias_cache (cnpj TEXT NOT NULL, janela TEXT NOT NULL, dados TEXT NOT NULL, buscado_em TEXT NOT NULL, PRIMARY KEY (cnpj, janela));

-- Cabeçalho das compras (órgão, modalidade, número, abertura, portal), vindo do PNCP.
CREATE TABLE IF NOT EXISTS compras_cabecalho (controle TEXT PRIMARY KEY, dados TEXT NOT NULL, buscado_em TEXT NOT NULL);

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
  'ALTER TABLE ia_uso ADD COLUMN cache_write_tokens INTEGER',
  'ALTER TABLE ia_uso ADD COLUMN modelo TEXT',
  'ALTER TABLE ia_uso ADD COLUMN referencia TEXT',
  'ALTER TABLE usuarios ADD COLUMN telegram_chat_id TEXT',
  'ALTER TABLE usuarios ADD COLUMN telegram_ativo INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE usuarios ADD COLUMN telegram_codigo TEXT',
  'ALTER TABLE usuarios ADD COLUMN telegram_desde TEXT',
  'ALTER TABLE notificacoes ADD COLUMN enviada_telegram INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE whatsapp_fila ADD COLUMN canal TEXT NOT NULL DEFAULT 'whatsapp'",
  'ALTER TABLE empresas ADD COLUMN endereco TEXT',
  'ALTER TABLE empresas ADD COLUMN representante TEXT',
  'ALTER TABLE empresas ADD COLUMN representante_cpf TEXT',
  'ALTER TABLE empresas ADD COLUMN representante_cargo TEXT',
  'ALTER TABLE empresas ADD COLUMN telefone TEXT',
  'ALTER TABLE empresas ADD COLUMN email TEXT',
  'ALTER TABLE empresas ADD COLUMN banco TEXT',
  'ALTER TABLE disputa_itens ADD COLUMN marca TEXT',
  'ALTER TABLE usuarios ADD COLUMN whatsapp TEXT',
  'ALTER TABLE usuarios ADD COLUMN whatsapp_ativo INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE usuarios ADD COLUMN whatsapp_desde TEXT',
  'ALTER TABLE notificacoes ADD COLUMN enviada_whatsapp INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE alertas ADD COLUMN municipios TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE sincronizacoes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'completa'",
  'ALTER TABLE oportunidades ADD COLUMN esfera TEXT',
  'ALTER TABLE oportunidades ADD COLUMN poder TEXT',
  'ALTER TABLE oportunidades ADD COLUMN codigo_ibge TEXT',
  'ALTER TABLE sincronizacoes ADD COLUMN progresso TEXT',
  "ALTER TABLE negocios ADD COLUMN origem TEXT",
  "ALTER TABLE negocios ADD COLUMN pontuacao INTEGER",
  "ALTER TABLE compra_itens ADD COLUMN situacao TEXT",
  "ALTER TABLE compra_itens ADD COLUMN criterio TEXT",
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
