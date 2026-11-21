# Melhorias do Busca Pregão IA

Registro das melhorias feitas por conta própria (rodada diária e ajustes), em linguagem simples.

## 21/11/2026 (rodada diária, 19h43)
- **Telas sem promessa de e-mail que não sai:** Alertas e Agentes diziam que o resumo e os avisos iam por e-mail, mas o envio de e-mail ainda não está configurado no servidor. Agora as telas avisam isso e explicam onde as novidades aparecem (Início, Meus negócios e Telegram). Quando o e-mail for configurado, os avisos somem sozinhos.

## 20/11/2026 (rodada diária, 19h43)
- **Alertas — prévia na hora:** ao criar ou editar um alerta, enquanto você digita as palavras aparece "Hoje este alerta encontraria X licitações abertas", com 3 exemplos. Se der zero, mostra dica para usar palavras mais gerais. Ajuda a montar alertas que o Agente Prospector consegue usar.

## 19/11/2026 (rodada diária, 19h43)
- **Pesquisa de preços (Histórico de compras) com singular e plural:** a busca achava os itens pela raiz da palavra, mas depois filtrava de novo pela palavra exata e descartava resultados: "copos descartáveis" perdia os itens escritos "Copo descartável", e "material" perdia "materiais". Agora os dois filtros usam a mesma regra. Também melhora o Agente Fornecedor, que usa essa pesquisa.

## 19/11/2026
- **Segurança do login:** depois de 5 senhas erradas para o mesmo e-mail (ou 20 do mesmo endereço de internet) em 15 minutos, o login fica bloqueado por 15 minutos. Impede que alguém fique tentando adivinhar a senha.
- **Cabeçalhos de segurança:** o site não pode mais ser aberto escondido dentro de outro site (golpe do clique escondido), o navegador sempre usa HTTPS e não vaza o endereço das páginas para outros sites.
- **Leitura do edital com os itens e valores oficiais:** a leitura agora mostra o quadro "Itens e valores que o órgão estima pagar", com todos os itens do PNCP (quantidade, unidade, valor unitário e total). O aviso do Agente Leitor no sino e no Telegram também traz quantos itens são, o total estimado e os 5 itens de maior valor.
- **Busca entende singular e plural:** procurar "material de limpeza" não achava as licitações escritas "materiais de limpeza" (e o mesmo com papel/papéis, licitação/licitações, copo/copos). Agora acha as duas formas. Com a base de teste, "material de limpeza" passou de 112 para 445 licitações (dispensas: de 17 para 47). Vale em Oportunidades, Alertas, Agente Prospector, Busca por item, Histórico e Busca no Chat.
- **Aviso de documentos perto de vencer** no sino e no Telegram (30, 15, 7, 3 e 1 dia antes, no dia e se vencer).

## 18/11/2026 (rodada diária, 19h43)
- **Servidor gastando menos (Railway):** a escuta do Telegram perguntava "chegou mensagem?" a cada 4 segundos, umas 21 mil vezes por dia. Agora usa a "espera longa" oficial do Telegram: a pergunta fica aberta até 25 s e volta na hora quando chega mensagem ou toque no botão "Ler este edital". São cerca de 6 vezes menos perguntas, e a resposta ficou até mais rápida.
- **Testes que venciam com o tempo:** dois testes automáticos usavam uma licitação com prazo fixo em 18/11/2026 e quebraram hoje (o sistema, corretamente, não deixa entrar no funil licitação com prazo vencido). Agora usam datas contadas a partir do dia atual.

## 17/11/2026 (rodada diária, 19h43)
- **Calculadora de preço — preço mínimo arredondado para cima:** antes o centavo era arredondado para baixo, e o lance mínimo da tabela mostrava "-0%" e um prejuízo de centavos no total do lote. Agora o preço mínimo e o preço com margem sobem para o centavo seguinte, então o lance mínimo nunca dá prejuízo.
- **Calculadora — tabela "E se fosse outro regime?":** as colunas da direita ficavam cortadas; títulos mais curtos e o aviso do Simples em uma linha separada.
- Conferidas no tema escuro as páginas novas (Calculadora, Fornecedores, Busca por item): sem problemas de leitura.

## 16/11/2026 (rodada diária, 19h43)
- **Agentes → Agente Prospector:** quando não há nenhum alerta cadastrado, aparece um aviso laranja "Falta um alerta" com o botão **Criar alerta** (antes era só uma frase pequena, fácil de não ver). Com alertas, mostra quantos estão sendo usados.
- **Fornecedores:** se a busca digitada não achar vendas (ex.: "ventilador de parede 60cm"), tenta sozinha pela palavra principal ("ventilador") e avisa na tela que fez isso.

## 16/11/2026
- **Agente Fornecedor mais rápido e sem depender do PNCP:** a busca de "quem vende cada item" (Sala de disputa → 4. Fornecedores) agora usa primeiro a base de itens que o sistema guarda todo dia (com vencedor e preço). Responde na hora, mesmo quando o PNCP está fora do ar; o PNCP só completa quando faltam fornecedores. "Papel A4" e parecidos não perdem mais o "A4" na busca.
- **Início — aviso quando a tela não carrega:** se o servidor ou a internet falharem, aparece um aviso com o botão "Tentar de novo" (antes ficavam só blocos cinza).
- **Início — contagem de dias nas disputas:** em "Próximas disputas" aparece "Hoje" (vermelho), "Amanhã" (laranja) ou "Em X dias".
  (Estas duas foram feitas pela rodada diária de 15/11, que não conseguiu publicar por falta de permissão no GitHub, e refeitas aqui.)
- **Nova página "Fornecedores" (menu):** digite um produto e veja quem já vendeu para o governo, por quanto e o contato, sem precisar abrir um negócio. O cartão do Agente Fornecedor (Agentes) agora tem um campo de busca que leva direto para ela.

## Ideias para conversar
- Liberar a rotina diária para publicar sozinha (permissão de envio do repositório na rotina).
