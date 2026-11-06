# Agenda — o que ficou para depois

Lista do que já combinamos fazer no **Busca Pregão IA**, por ordem sugerida.
Para retomar, é só abrir a conversa e dizer qual item quer fazer.

## 1. Configurações rápidas (você faz no Railway / Registro.br, com a minha ajuda)

- [ ] **Domínio `app.buscapregaoia.com.br`**: registros CNAME e TXT criados no Registro.br em 05/11/2026.
      Falta: conferir o selo verde no Railway e criar `APP_URL`. Registros usados:
      - `CNAME` · nome `app` · dados `6dqhqd63.up.railway.app`
      - `TXT` · nome `_railway-verify.app` · dados = código completo `railway-verify=...`
        (copiar no Railway: serviço → Settings → Networking)
      - Depois criar a variável `APP_URL=https://app.buscapregaoia.com.br` no Railway.
- [ ] **Código de convite da equipe**: variável `CODIGO_CONVITE` no Railway.
- [x] **Chave da IA**: `ANTHROPIC_API_KEY` cadastrada no Railway (05/11/2026, `/api/saude` mostra `ia: true`).
- [ ] Testar a leitura de um edital e ligar o **Agente Leitor**.
- [ ] **E-mail dos alertas e agentes**: escolher um serviço de envio (Gmail, Brevo, Amazon SES…) e
      cadastrar `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- [ ] **Histórico de 12 meses**: acompanhar em `/api/saude` o uso do disco (volume de 5 GB) e o período
      carregado (`historico.desde`).

## 2. Avisos pelo WhatsApp (e Telegram)

- [x] Integração com a **API oficial do WhatsApp (Meta)** no sistema: número e autorização por usuário (página
      Agentes), aviso de cada agente pelo WhatsApp, edital em PDF de cada licitação nova do Prospector e botão
      "Enviar edital no meu WhatsApp" na licitação.
- [ ] **Você faz na Meta** (com a minha ajuda): conta Meta Business + app WhatsApp, número só para o sistema,
      token permanente (usuário do sistema), e os 2 modelos de mensagem (Utilidade, pt_BR):
      - `aviso_busca_pregao`: corpo "🔔 *{{1}}*" + linha em branco + "{{2}}" + linha em branco + "Busca Pregão IA".
      - `edital_busca_pregao`: cabeçalho **Documento** + corpo "📄 *Edital:* {{1}}" + linha em branco + "{{2}}".
- [ ] No Railway: `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_ID` (opcional: `WHATSAPP_TEMPLATE_AVISO`, `WHATSAPP_TEMPLATE_EDITAL`).
- [ ] (Opcional) **Robô do Telegram** como alternativa gratuita enquanto a Meta aprova.
- Não usar serviços não oficiais (Z-API, Evolution API etc.): risco de bloqueio do número.

## 3. Agentes — etapas 2 e 3

- [x] **Agente Jurídico** (página *Peças jurídicas*): análise de irregularidades do edital e rascunhos de
      esclarecimento, impugnação, recurso e contrarrazões, para revisão de advogado. Baixa em Word.
- [ ] Testar o Agente Jurídico com um edital real em produção e ajustar o texto das peças com um advogado.
- [x] **Agente Fornecedor** (Sala de disputa → 4. Fornecedores): quem venceu itens parecidos no PNCP, preços por
      unidade, contato público da Receita, planilha e e-mail de cotação.
- [x] **Busca Pregão no Chat** (conector MCP para Claude e ChatGPT, página *Busca no Chat*, link pessoal).
- [ ] Testar o conector no Claude/ChatGPT com o link gerado em produção.
- [ ] (Opcional) Assistente de chat dentro do próprio sistema.

## 3b. Automação do começo ao fim

- [x] **Agente Habilitação**: documentos exigidos no edital x documentos cadastrados (em dia, vence antes da
      sessão, vencido, falta, declaração). Card no negócio; o Agente Leitor manda "apto / faltam X" no aviso.
- [x] **Proposta pronta** (Sala de disputa → Gerar proposta): inicial ou ajustada, dados da empresa salvos,
      valor por extenso, baixa em Word. O cadastro no portal continua manual (login gov.br + captcha).

## 4. Outras melhorias anotadas

- [x] **Vitórias em licitações** na Análise de empresas (feito), com dados oficiais do Compras.gov.br
      (`dadosabertos.compras.gov.br`, endpoint `consultarResultadoItensContratacoes_PNCP_14133` filtrado por
      `niFornecedor`, até 365 dias por consulta): itens vencidos, valor vencido homologado por ano, órgãos e
      estados, uso do benefício ME/EPP e preços unitários. Pregões da lei antiga (`modulo-legado`) estavam
      sem responder nos testes. Participações e derrotas não existem em dados públicos: não estimar.

- [ ] **Filtro e selo por portal** (Compras.gov.br, Portal de Compras Públicas, BLL, Licitanet, BNC…).
- [x] **Assistente de disputa** (Sala de disputa no negócio, sem lance automático): preço mínimo por item,
      próximo lance, aviso de parar, preços pagos no PNCP e registro dos lances.
- [x] **Leitor do chat do pregoeiro** (aba na Sala de disputa: cola o chat, IA aponta prazos e cria lembretes).
      Leitura automática do chat não é possível: não há dado público e o portal exige login gov.br + captcha.
- [ ] Lance automático: só com regras dos portais validadas por especialista e API oficial; hoje não fazer.
- [ ] Relatórios de desempenho (taxa de vitória, valores ganhos).
- [ ] App para celular (Android/iPhone).
- [ ] Equipe com permissões.
- [ ] Planos e cobrança, se for vender o sistema para outras empresas.
