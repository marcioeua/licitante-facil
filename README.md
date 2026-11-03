# Licitante Fácil

Plataforma para empresas encontrarem licitações públicas e organizarem a participação nelas.

## Funcionalidades

- **Oportunidades**: busca nas licitações com propostas abertas importadas do
  [PNCP](https://pncp.gov.br) (Portal Nacional de Contratações Públicas), com texto livre
  (sem diferenciar acentos), UF, modalidade, faixa de valor e registro de preço.
- **Meus negócios**: funil em kanban (Triagem → Em análise → Proposta → Disputa → Ganho/Perdido),
  com responsável, data da disputa, valor da proposta, anotações, favoritos e arquivamento.
- **Checklist** por negócio, já criado com as etapas típicas de um pregão.
- **Documentos**: certidões, contrato social, atestados etc., com upload, validade e aviso de vencimento.
- **Agenda**: datas de disputa, vencimentos de documentos e compromissos próprios.
- **Alertas**: palavras-chave + filtros; as novidades aparecem no início e chegam por e-mail.
- **Empresas**: vários CNPJs por conta (com validação do CNPJ).

## Tecnologia

| Parte | Stack |
|---|---|
| Front-end | Vue 3 + Quasar 2 (Vite), Pinia, vuedraggable |
| Back-end | Node.js 22+ com Fastify 5 |
| Banco | SQLite embutido no Node (`node:sqlite`) com busca FTS5 |
| Dados | API pública de consultas do PNCP |

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

## Testes

```bash
cd backend && npm test
```

## Próximos passos

- Leitura de editais com IA (perguntas sobre o PDF do edital)
- Análise de preços praticados a partir dos contratos e atas publicados no PNCP
- Alertas por WhatsApp
- App Android/iOS com Capacitor (o Quasar já gera)
