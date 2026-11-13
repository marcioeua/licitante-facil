<template>
  <q-page padding>
    <div class="row items-center q-mb-xs">
      <q-icon name="help" color="primary" size="28px" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Como usar</div>
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">O caminho de uma licitação, do começo ao fim. Clique nos botões para ir direto a cada parte.</div>

    <q-input v-model="busca" outlined dense clearable placeholder="Procurar no guia (ex.: proposta, lance, atestado, Telegram)" class="q-mb-md" style="max-width: 560px">
      <template #prepend><q-icon name="search" /></template>
    </q-input>

    <div class="row q-col-gutter-md">
      <div v-for="s in secoesFiltradas" :key="s.titulo" class="col-12 col-lg-6">
        <q-card flat bordered class="lf-card full-height">
          <q-card-section class="row items-center no-wrap q-pb-sm">
            <q-avatar :color="s.cor" text-color="white" size="40px" class="q-mr-md text-weight-bold">{{ s.numero }}</q-avatar>
            <div>
              <div class="text-subtitle1 text-weight-bold">{{ s.titulo }}</div>
              <div class="text-caption text-grey-7">{{ s.resumo }}</div>
            </div>
          </q-card-section>
          <q-list dense class="q-pb-sm">
            <q-item v-for="p in s.passos" :key="p.texto" :clickable="!!p.ir" :to="p.ir" class="q-py-sm">
              <q-item-section avatar><q-icon :name="p.icone" :color="s.cor" /></q-item-section>
              <q-item-section>
                <q-item-label class="text-body2" v-html="p.texto" />
                <q-item-label v-if="p.dica" caption>{{ p.dica }}</q-item-label>
              </q-item-section>
              <q-item-section v-if="p.ir" side><q-icon name="chevron_right" color="grey-6" /></q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>
    </div>
    <div v-if="!secoesFiltradas.length" class="text-grey-7 q-pa-md">Nada encontrado. Tente outra palavra ou pergunte ao <router-link :to="{ name: 'assistente' }">Assistente IA</router-link>.</div>

    <q-card flat bordered class="lf-card q-mt-md">
      <q-card-section class="row items-center q-gutter-md">
        <q-icon name="auto_awesome" color="primary" size="32px" />
        <div class="col">
          <div class="text-subtitle1 text-weight-bold">Ficou com dúvida?</div>
          <div class="text-body2 text-grey-7">Pergunte ao Assistente IA, por texto ou por voz, por exemplo: "como faço a proposta?" ou "quais licitações tenho esta semana?".</div>
        </div>
        <q-btn unelevated no-caps color="primary" icon="auto_awesome" label="Abrir o Assistente IA" :to="{ name: 'assistente' }" />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { ref, computed } from 'vue';

const SECOES = [
  {
    titulo: 'Configure uma vez', resumo: 'Para o sistema trabalhar sozinho por você.', cor: 'blue-grey-7',
    passos: [
      { icone: 'business', texto: 'Cadastre a sua <b>empresa</b> (razão social e CNPJ).', ir: { name: 'empresas' } },
      { icone: 'folder_shared', texto: 'Cadastre seus <b>documentos com a data de validade</b> (certidões, contrato social, atestados).', dica: 'É com eles que o sistema diz se você está apto.', ir: { name: 'documentos' } },
      { icone: 'notifications_active', texto: 'Crie <b>alertas</b> com as palavras do que você vende (ex.: material de limpeza, detergente).', ir: { name: 'alertas' } },
      { icone: 'smart_toy', texto: 'Ligue os <b>agentes</b> Prospector, Vigia e Leitor, e conecte o <b>Telegram</b> para receber os editais no celular.', ir: { name: 'agentes' } },
    ],
  },
  {
    titulo: 'Ache licitações', resumo: 'Do jeito que preferir: busca, chat ou agentes.', cor: 'blue-7',
    passos: [
      { icone: 'travel_explore', texto: '<b>Oportunidades</b>: busque por palavra, estado, cidade, valor e modalidade.', ir: { name: 'oportunidades' } },
      { icone: 'manage_search', texto: '<b>Busca por item</b>: procure o produto dentro dos itens das licitações, com situação, quantidade e quem venceu.', ir: { name: 'itens' } },
      { icone: 'auto_awesome', texto: '<b>Assistente IA</b>: pergunte por texto ou voz ("pregões de limpeza em MG até 100 mil").', ir: { name: 'assistente' } },
      { icone: 'forum', texto: '<b>Busca no Chat</b>: use o sistema dentro do Claude ou do ChatGPT.', ir: { name: 'chat' } },
      { icone: 'smart_toy', texto: 'O <b>Agente Prospector</b> faz isso sozinho todo dia às 7h e coloca as melhores em Meus negócios.', ir: { name: 'agentes' } },
    ],
  },
  {
    titulo: 'Analise antes de participar', resumo: 'Vale a pena? Você está apto?', cor: 'indigo-7',
    passos: [
      { icone: 'view_kanban', texto: 'Clique em <b>Adicionar ao funil</b> na licitação. Ela vai para <b>Meus negócios</b>.', ir: { name: 'negocios' } },
      { icone: 'auto_stories', texto: 'Na licitação, use <b>Ler edital com IA</b>: resumo, documentos, prazos e pontos de atenção.', dica: 'O Agente Leitor faz isso sozinho para o que entra no funil.' },
      { icone: 'verified_user', texto: 'No negócio, o quadro <b>Habilitação: estou apto?</b> compara o edital com os seus documentos.' },
      { icone: 'speed', texto: '<b>Pagômetro</b>: veja se o órgão costuma pagar em dia.', ir: { name: 'pagometro' } },
      { icone: 'balance', texto: 'Achou algo errado no edital? <b>Peças jurídicas</b>: análise e impugnação ou pedido de esclarecimento.', ir: { name: 'juridico' } },
      { icone: 'insights', texto: 'Para entender o mercado: <b>Análise de mercado</b>, <b>Análise de empresas</b> e <b>Histórico de compras</b>.', ir: { name: 'mercado' } },
    ],
  },
  {
    titulo: 'Prepare a proposta', resumo: 'Custos, preço mínimo e proposta pronta.', cor: 'teal-7',
    passos: [
      { icone: 'gavel', texto: 'Abra a <b>Sala de disputa</b> (menu ou botão no negócio) e clique em <b>Importar itens do PNCP</b>.', ir: { name: 'salas' } },
      { icone: 'local_shipping', texto: 'Aba <b>4. Fornecedores</b>: veja quem vende cada item e mande a planilha e o e-mail de cotação.' },
      { icone: 'calculate', texto: '<b>Calculadora de preço</b>: preço mínimo sem prejuízo, impostos do seu regime, DIFAL e lucro em cada lance (botão 🧮 em cada item da Sala).', ir: { name: 'calculadora' } },
      { icone: 'calculate', texto: 'Aba <b>1. Preparar preços</b>: coloque o custo, a margem e a marca. O sistema calcula o <b>preço mínimo</b>.' },
      { icone: 'request_quote', texto: 'Botão <b>Gerar proposta</b>: baixe o Word pronto e anexe no portal.', dica: 'O cadastro no portal é feito por você (login gov.br).' },
    ],
  },
  {
    titulo: 'No dia da disputa', resumo: 'O sistema calcula e avisa; você dá os lances no portal.', cor: 'deep-orange-7',
    passos: [
      { icone: 'bolt', texto: 'Sala de disputa → aba <b>2. Modo disputa</b>: o painel com todos os itens.', ir: { name: 'salas' } },
      { icone: 'keyboard', texto: 'Digite o melhor lance da sala e aperte <b>Enter</b>. Aperte <b>C</b> para copiar o próximo lance e cole no portal, depois <b>D</b> para marcar "dei".', dica: 'Som avisa quando cobrem seu lance e quando chegar no mínimo.' },
      { icone: 'campaign', texto: 'Aba <b>3. Chat do pregoeiro</b>: cole as mensagens. A IA mostra o que é com você e coloca os prazos na Agenda.' },
      { icone: 'balance', texto: 'Precisou recorrer? <b>Peças jurídicas</b>: recurso ou contrarrazões.', ir: { name: 'juridico' } },
    ],
  },
  {
    titulo: 'Acompanhe', resumo: 'Avisos, prazos e custos.', cor: 'purple-7',
    passos: [
      { icone: 'event', texto: '<b>Agenda</b>: sessões, prazos do pregoeiro e vencimento de documentos.', ir: { name: 'agenda' } },
      { icone: 'notifications', texto: 'O <b>sino</b> (no topo) e o <b>Telegram</b> trazem os avisos dos agentes.' },
      { icone: 'send', texto: 'No <b>Telegram</b>, cada licitação que entra na triagem chega com o botão <b>Ler este edital com IA</b>: toque e o resumo chega na conversa.', ir: { name: 'agentes' } },
      { icone: 'paid', texto: '<b>Uso da IA</b>: quanto cada leitura custou e o limite de gasto do mês.', ir: { name: 'uso-ia' } },
    ],
  },
];

const busca = ref('');
const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, '');
const secoesFiltradas = computed(() => {
  const q = norm(busca.value).trim();
  const todas = SECOES.map((s, i) => ({ ...s, numero: i + 1 }));
  if (!q) return todas;
  return todas.map((s) => ({ ...s, passos: s.passos.filter((p) => norm(`${s.titulo} ${p.texto} ${p.dica ?? ''}`).includes(q)) }))
    .filter((s) => s.passos.length);
});
</script>
