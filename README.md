# Licitante Fácil

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
- **Alertas**: palavras-chave + filtros (inclusive cidades); as novidades aparecem no início e chegam por e-mail.
- **Empresas**: vários CNPJs por conta (com validação do CNPJ).

## Tecnologia

| Parte | Stack |
|---|---|
| Front-end | Vue 3 + Quasar 2 (Vite), Pinia, vuedraggable |
| Back-end | Node.js 22+ com Fastify 5 |
| Banco | SQLite embutido no Node (`node:sqlite`) com busca FTS5 |
| Dados | API pública de consultas do PNCP |
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

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install --omit=dev
cp .env.example .env   # preencha SESSION_SECRET e SMTP
NODE_ENV=production npm start   # serve a API e o front-end compilado na mesma porta
```

Agende as tarefas (cron):

```cron
15 */2 * * *  cd /caminho/backend && npm run sync      # a cada 2 horas
30 7 * * *    cd /caminho/backend && npm run alertas   # e-mails diários às 7h30
```

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

- Análise de preços praticados a partir dos contratos e atas publicados no PNCP
- Alertas por WhatsApp
- App Android/iOS com Capacitor (o Quasar já gera)
