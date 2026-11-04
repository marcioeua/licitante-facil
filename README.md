# Busca Pregão IA

Plataforma para empresas encontrarem licitações públicas e organizarem a participação nelas.

## Funcionalidades

- **Oportunidades**: busca nas licitações com propostas abertas importadas do
  [PNCP](https://pncp.gov.br) (Portal Nacional de Contratações Públicas), com texto livre
  (sem diferenciar acentos), UF, cidade, modalidade, faixa de valor e registro de preço.
- **Leitura do edital com IA**: baixa o edital e os anexos do PNCP (PDF, ZIP ou Word) e gera um
  resumo com prazos, documentos de habilitação, itens, requisitos da proposta e pontos de atenção.
  Depois o usuário faz perguntas livres e cada resposta mostra a página do edital usada como fonte.
- **Meus negócios**: funil em kanban (Triagem → Em análise → Proposta → Disputa → Ganho/Perdido),
  com responsável, data da disputa, valor da proposta, anotações, favoritos e arquivamento.
- **Checklist** por negócio, já criado com as etapas típicas de um pregão.
- **Documentos**: certidões, contrato social, atestados etc., com upload, validade e aviso de vencimento.
- **Agenda**: datas de disputa, vencimentos de documentos e compromissos próprios.
- **Pagômetro**: indica se o órgão tende a pagar em dia, pela nota CAPAG (capacidade de pagamento)
  que o Tesouro Nacional publica para estados e municípios. Aparece em cada licitação, como selo na
  busca e numa página de consulta. Dados atualizados toda semana do Tesouro Transparente.
- **Histórico de compras**: quem comprou, quem venceu e por quanto. Contratos do PNCP (últimos
  `HISTORICO_DIAS` dias, padrão 30) com os fornecedores que mais vencem e os órgãos que mais compram,
  e pesquisa de preços unitários homologados por item (menor, mediana e maior, por unidade).
- **Alertas**: palavras-chave + filtros (inclusive cidades); as novidades aparecem no início e chegam por e-mail.
- **Empresas**: vários CNPJs por conta (com validação do CNPJ).

## Tecnologia

| Parte | Stack |
|---|---|
| Front-end | Vue 3 + Quasar 2 (Vite), Pinia, vuedraggable |
| Back-end | Node.js 22+ com Fastify 5 |
| Banco | SQLite embutido no Node (`node:sqlite`) com busca FTS5 |
| Dados | API pública de consultas do PNCP; CAPAG do Tesouro Transparente |
| IA | Claude (Anthropic) via `@anthropic-ai/sdk`, com Files API, saída estruturada e citações |

## Rodando localmente

Requisitos: Node.js 22.13 ou mais novo.

```bash
cd backend && npm install && npm run sync   # importa as licitações abertas do PNCP
npm run dev                                 # API em http://localhost:3333
```

Em outro terminal:

```bash
cd frontend && npm install && npm run dev   # app em http://localhost:9000
```

## Produção

A forma recomendada é o container Docker (`Dockerfile` na raiz), que compila o front-end e
roda a API, a atualização automática do PNCP e os alertas num único processo. O banco e os
arquivos ficam em `/data`, que deve ser um volume persistente.

Passo a passo para o Railway: [PUBLICAR.md](PUBLICAR.md).

```bash
docker build -t licitante-facil .
docker run -p 3333:3333 -v licitante-dados:/data -e ANTHROPIC_API_KEY=... licitante-facil
```

Tarefas automáticas (desligue com `AGENDADOR=off`): atualização incremental do PNCP a cada
2 horas, recarga completa às 3h e alertas por e-mail às 7h30 (horário de Brasília).

Em produção, o cadastro de contas fecha depois da primeira (a do dono). Para liberar sua equipe,
defina `CODIGO_CONVITE`, ou `CADASTRO_ABERTO=true` para abrir a todos.

## Leitura de editais com IA

Defina `ANTHROPIC_API_KEY` no `.env` (crie a chave em https://console.anthropic.com). Sem a chave,
o restante do sistema funciona e a tela do edital avisa que a IA não está configurada.

- Os arquivos de cada edital são enviados uma vez à Files API e reaproveitados por 30 dias.
- O resumo é gerado uma vez por licitação e compartilhado entre todos os usuários.
- Perguntas reaproveitam o edital em cache por alguns minutos, o que barateia perguntas seguidas.
- Limite por usuário: `IA_LIMITE_DIARIO` (padrão 30 análises por dia).
- Até 8 arquivos e cerca de 550 páginas por licitação; o que passar disso aparece como "não lido".

## Testes

```bash
cd backend && npm test
```

## Próximos passos

- Assistente de chat dentro do sistema (perguntas sobre licitações, preços e funil em linguagem natural)
  e conector MCP para usar o sistema direto no Claude ou no ChatGPT.

- Filtro e selo por portal de disputa (Compras.gov.br, Portal de Compras Públicas, BLL, Licitanet,
  BNC, Licitações-e etc.), identificado pelo domínio de `linkSistemaOrigem` e pelo `usuarioNome`
  que o PNCP informa como sistema de origem.

- Assistente de disputa (sem lance automático): preço mínimo por item, calculadora do próximo
  lance respeitando o intervalo do portal, histórico de preços praticados (PNCP) e lembretes
  antes da sessão. Antes de qualquer automação de lances, validar as regras do portal com um
  especialista em licitações.

- Análise de preços praticados a partir dos contratos e atas publicados no PNCP
- Alertas por WhatsApp
- App Android/iOS com Capacitor (o Quasar já gera)
