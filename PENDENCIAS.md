# Agenda — o que ficou para depois

Lista do que já combinamos fazer no **Busca Pregão IA**, por ordem sugerida.
Para retomar, é só abrir a conversa e dizer qual item quer fazer.

## 1. Configurações rápidas (você faz no Railway / Registro.br, com a minha ajuda)

- [ ] **Domínio `app.buscapregaoia.com.br`**: quando o Registro.br terminar a transição para o modo
      avançado, em *Configurar zona DNS* → *Nova entrada*, criar:
      - `CNAME` · nome `app` · dados `6dqhqd63.up.railway.app`
      - `TXT` · nome `_railway-verify.app` · dados = código completo `railway-verify=...`
        (copiar no Railway: serviço → Settings → Networking)
      - Depois criar a variável `APP_URL=https://app.buscapregaoia.com.br` no Railway.
- [ ] **Código de convite da equipe**: variável `CODIGO_CONVITE` no Railway.
- [ ] **Chave da IA**: criar em https://console.anthropic.com e cadastrar `ANTHROPIC_API_KEY` no Railway.
      Depois: testar a leitura de um edital e ligar o **Agente Leitor**.
- [ ] **E-mail dos alertas e agentes**: escolher um serviço de envio (Gmail, Brevo, Amazon SES…) e
      cadastrar `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- [ ] **Histórico de 12 meses**: acompanhar em `/api/saude` o uso do disco (volume de 5 GB) e o período
      carregado (`historico.desde`).

## 2. Avisos pelo WhatsApp (e Telegram)

- [ ] Criar conta **Meta Business** e separar um **número de telefone só para o sistema**.
- [ ] Integrar a **API oficial do WhatsApp (Meta)**: campo de número por usuário, opção de receber por
      WhatsApp em cada agente, modelo de mensagem para aprovação da Meta.
- [ ] (Opcional) **Robô do Telegram** como alternativa gratuita enquanto a Meta aprova.
- Não usar serviços não oficiais (Z-API, Evolution API etc.): risco de bloqueio do número.

## 3. Agentes — etapas 2 e 3

- [ ] **Agente Jurídico** (precisa da chave da IA): lê o edital, aponta possíveis irregularidades e
      redige rascunhos de pedido de esclarecimento, impugnação e recurso, sempre para revisão de advogado.
- [ ] **Agente Fornecedor**: sugere quem vende cada item (pelo histórico de compras) e monta a planilha
      e o e-mail de cotação.
- [ ] **Busca Pregão no Chat**: assistente de chat dentro do sistema e conector (MCP) para usar no
      Claude e no ChatGPT.

## 4. Outras melhorias anotadas

- [x] **Vitórias em licitações** na Análise de empresas (feito), com dados oficiais do Compras.gov.br
      (`dadosabertos.compras.gov.br`, endpoint `consultarResultadoItensContratacoes_PNCP_14133` filtrado por
      `niFornecedor`, até 365 dias por consulta): itens vencidos, valor vencido homologado por ano, órgãos e
      estados, uso do benefício ME/EPP e preços unitários. Pregões da lei antiga (`modulo-legado`) estavam
      sem responder nos testes. Participações e derrotas não existem em dados públicos: não estimar.

- [ ] **Filtro e selo por portal** (Compras.gov.br, Portal de Compras Públicas, BLL, Licitanet, BNC…).
- [ ] **Assistente de disputa** (sem lance automático): preço mínimo por item, calculadora de lance,
      histórico de preços e lembretes. Validar regras dos portais com especialista antes de qualquer automação.
- [ ] Relatórios de desempenho (taxa de vitória, valores ganhos).
- [ ] App para celular (Android/iPhone).
- [ ] Equipe com permissões.
- [ ] Planos e cobrança, se for vender o sistema para outras empresas.
