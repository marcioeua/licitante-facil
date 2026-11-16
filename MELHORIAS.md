# Melhorias do Busca Pregão IA

Registro das melhorias feitas por conta própria (rodada diária e ajustes), em linguagem simples.

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
