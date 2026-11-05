# Como publicar o Busca Pregão IA (Railway)

O sistema roda num único serviço: a mesma aplicação entrega o site, a API, a atualização
automática do PNCP e os alertas por e-mail. O banco de dados (SQLite) e os arquivos enviados
ficam num **volume** persistente montado em `/data`.

Custo estimado no Railway: plano Hobby (cerca de US$ 5/mês, com US$ 5 de uso incluídos).
A IA da Anthropic é cobrada à parte, conforme o uso.

> Os nomes dos botões do Railway podem mudar um pouco com o tempo. Se algo estiver diferente,
> procure a opção equivalente.

## 1. Criar o projeto

1. Acesse https://railway.com e entre com sua conta do **GitHub** (`marcioeua`).
2. Clique em **New Project** → **Deploy from GitHub repo**.
3. Se pedir, autorize o Railway a acessar o repositório `licitante-facil`.
4. Escolha `marcioeua/licitante-facil`. O Railway encontra o `Dockerfile` e começa a construir.

## 2. Criar o volume (obrigatório)

Sem o volume, os dados são apagados a cada nova versão.

1. No projeto, clique com o botão direito no serviço (ou em **+ Create**) → **Volume**.
2. Ligue o volume ao serviço `licitante-facil`.
3. Em **Mount path**, digite: `/data`

## 3. Configurar as variáveis

No serviço, abra a aba **Variables** e adicione:

| Variável | Obrigatória? | Valor |
|---|---|---|
| `ANTHROPIC_API_KEY` | Para a leitura com IA | Sua chave criada em https://console.anthropic.com |
| `CODIGO_CONVITE` | Recomendada | Um código que você vai passar para sua equipe se cadastrar |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Para alertas por e-mail | Dados do seu serviço de e-mail (Gmail, Brevo, Amazon SES…) |
| `IA_LIMITE_DIARIO` | Opcional | Análises com IA por usuário por dia (padrão 30) |
| `HISTORICO_DIAS` | Opcional | Dias de contratos guardados (padrão 365; cerca de 200 MB de disco por mês). Se o disco ficar com menos de 15% livre (mínimo `HISTORICO_LIVRE_MINIMO_MB`, padrão 400), o sistema para de buscar meses antigos; se ficar muito cheio, apaga os mais antigos. `/api/saude` mostra o uso do disco |

Não é preciso configurar porta, banco, fuso horário nem `SESSION_SECRET`: a imagem já define
isso, e o segredo de login é gerado sozinho no primeiro início e guardado no volume.

## 4. Gerar o endereço do site

1. No serviço, abra **Settings** → **Networking** → **Generate Domain**.
2. O Railway cria um endereço como `licitante-facil-production.up.railway.app`.
3. (Opcional) Em **Custom Domain** você pode usar um domínio próprio, como `app.buscapregaoia.com.br`.

## 5. Primeiro acesso

1. Abra o endereço. **A primeira conta criada é a sua** (o cadastro fecha depois dela).
2. Para sua equipe entrar, passe o endereço e o `CODIGO_CONVITE`.
3. A primeira carga de licitações do PNCP começa sozinha e leva cerca de 40 minutos.
   Enquanto isso o sistema já funciona e as licitações vão aparecendo.

## Domínio próprio (opcional)

1. Compre o domínio (para `.com.br`: https://registro.br, cerca de R$ 40/ano).
2. No Railway: serviço → **Settings** → **Networking** → **Custom Domain**. Use um subdomínio,
   por exemplo `app.seudominio.com.br`.
3. O Railway mostra um registro **CNAME** (e às vezes um **TXT** de verificação). No painel DNS
   do domínio (no Registro.br: "Editar zona"), crie exatamente esses registros:
   tipo `CNAME`, nome `app`, valor o endereço indicado pelo Railway.
4. Aguarde de minutos a algumas horas, até o Railway mostrar o domínio como ativo. O https é automático.
5. Crie a variável `APP_URL` com o novo endereço (ex.: `https://app.seudominio.com.br`) para os
   links dos e-mails de alerta usarem o seu domínio.

O domínio "puro" (sem `app.`) exige um DNS com CNAME flattening, como a Cloudflare (gratuita);
o Registro.br não oferece esse recurso.

## Rotina automática

| Quando | O quê |
|---|---|
| A cada 2 horas | Busca no PNCP só as licitações que mudaram |
| Todo dia às 3h | Recarga completa das licitações abertas |
| Todo dia às 7h30 | Envia os alertas por e-mail (se o SMTP estiver configurado) |
| Toda semana | Atualiza as notas CAPAG do Pagômetro (Tesouro Transparente) |
| Nos intervalos livres | Importa os contratos do PNCP para o histórico de compras (hoje e ontem a cada 6h; dias passados até `HISTORICO_DIAS`) |

Para conferir se está tudo bem, abra `https://SEU-ENDERECO/api/saude`: mostra a última
sincronização com o PNCP e se a IA está configurada.

## Atualizações

Cada envio para a branch `main` no GitHub faz o Railway publicar a nova versão sozinho.
Os dados continuam no volume.
