<template>
  <q-card flat bordered class="lf-card">
    <q-card-section class="row items-center">
      <q-icon name="auto_awesome" color="primary" size="24px" class="q-mr-sm" />
      <div class="text-h6 col">Leitura do edital com IA</div>
      <q-badge v-if="estado?.resumo" color="blue-1" text-color="primary" label="Resumo pronto" />
    </q-card-section>

    <q-card-section v-if="!estado" class="q-pt-none"><q-skeleton height="80px" /></q-card-section>

    <q-card-section v-else-if="!estado.iaDisponivel" class="q-pt-none">
      <q-banner class="bg-grey-2 lf-card">
        <template #avatar><q-icon name="info" color="grey-7" /></template>
        A leitura com IA ainda não foi ativada neste servidor. O administrador precisa configurar a chave da IA (ANTHROPIC_API_KEY).
      </q-banner>
    </q-card-section>

    <template v-else>
      <!-- Ainda sem resumo -->
      <q-card-section v-if="!estado.resumo" class="q-pt-none">
        <div v-if="!lendo" class="text-body2 text-grey-8 q-mb-md">
          A IA baixa o edital e os anexos do PNCP, lê tudo e monta um resumo com prazos, documentos de habilitação,
          itens e pontos de atenção. Depois você pode fazer perguntas sobre o edital.
        </div>
        <q-btn v-if="!lendo" unelevated no-caps color="primary" icon="auto_awesome" label="Ler edital com IA" @click="resumir" />
        <div v-else class="row items-center q-gutter-md q-py-md">
          <q-spinner-dots color="primary" size="40px" />
          <div>
            <div class="text-weight-medium">{{ etapas[etapa] }}</div>
            <div class="text-caption text-grey-7">Editais grandes podem levar até 2 minutos. Pode continuar usando o sistema.</div>
          </div>
        </div>
      </q-card-section>

      <!-- Resumo -->
      <template v-else>
        <q-card-section class="q-pt-none">
          <div class="text-subtitle1 text-weight-medium">{{ r.objeto }}</div>
          <div class="text-body2 q-mt-xs">{{ r.resumo }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="row q-col-gutter-md">
            <div v-for="c in fatos" :key="c.nome" class="col-12 col-sm-6 col-md-4">
              <div class="text-caption text-grey-7">{{ c.nome }}</div>
              <div class="text-body2">{{ c.valor }}</div>
            </div>
          </div>
        </q-card-section>

        <q-card-section v-if="r.pontos_atencao?.length" class="q-pt-none">
          <q-banner class="bg-orange-1 lf-card">
            <div class="text-weight-medium text-orange-10 q-mb-xs"><q-icon name="warning" /> Pontos de atenção</div>
            <ul class="q-my-none q-pl-md"><li v-for="(p, i) in r.pontos_atencao" :key="i">{{ p }}</li></ul>
          </q-banner>
        </q-card-section>

        <q-list>
          <q-expansion-item v-if="r.documentos_habilitacao?.length" icon="fact_check" :label="`Documentos de habilitação (${r.documentos_habilitacao.length})`" default-opened>
            <q-card-section class="q-pt-none">
              <div v-for="(docs, grupo) in docsPorGrupo" :key="grupo" class="q-mb-sm">
                <div class="text-caption text-weight-bold text-grey-8">{{ GRUPOS[grupo] }}</div>
                <ul class="q-my-xs q-pl-md"><li v-for="(d, i) in docs" :key="i">{{ d.descricao }}</li></ul>
              </div>
              <q-btn v-if="negocioId" outline no-caps color="primary" icon="playlist_add" label="Adicionar ao checklist do negócio" :loading="addChecklist" @click="adicionarChecklist" />
            </q-card-section>
          </q-expansion-item>
          <q-expansion-item v-if="r.itens_principais?.length" icon="inventory_2" :label="`Itens principais (${r.itens_principais.length})`">
            <q-markup-table flat dense class="q-mx-md q-mb-md">
              <thead><tr><th class="text-left">Descrição</th><th class="text-right">Qtd.</th><th class="text-right">Valor estimado</th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in r.itens_principais" :key="i">
                  <td class="text-left" style="white-space: normal">{{ it.descricao }}</td>
                  <td class="text-right">{{ it.quantidade ?? '—' }}</td>
                  <td class="text-right">{{ it.valor_estimado ?? '—' }}</td>
                </tr>
              </tbody>
            </q-markup-table>
          </q-expansion-item>
          <q-expansion-item v-if="r.requisitos_proposta?.length" icon="request_quote" label="O que a proposta precisa ter">
            <ul class="q-mt-none q-mb-md q-pl-xl q-pr-md"><li v-for="(p, i) in r.requisitos_proposta" :key="i">{{ p }}</li></ul>
          </q-expansion-item>
          <q-expansion-item icon="description" :label="`Arquivos lidos (${estado.arquivos.length})`">
            <q-card-section class="q-pt-none text-body2">
              <div v-for="a in estado.arquivos" :key="a.nome"><q-icon name="check" color="positive" /> {{ a.nome }}<span v-if="a.paginas" class="text-grey-7"> · {{ a.paginas }} pág.</span></div>
              <div v-for="a in estado.ignorados" :key="a.nome" class="text-grey-7"><q-icon name="block" /> {{ a.nome }} — {{ a.motivo }}</div>
            </q-card-section>
          </q-expansion-item>
        </q-list>
      </template>

      <!-- Perguntas -->
      <q-separator />
      <q-card-section>
        <div class="text-subtitle1 text-weight-medium q-mb-sm">Pergunte sobre o edital</div>
        <div v-for="p in estado.perguntas" :key="p.id" class="q-mb-md">
          <div class="row justify-end q-mb-xs">
            <div class="bg-primary text-white q-px-md q-py-sm" style="border-radius: 12px 12px 2px 12px; max-width: 85%">{{ p.pergunta }}</div>
          </div>
          <div class="bg-grey-2 q-px-md q-py-sm" style="border-radius: 12px 12px 12px 2px; max-width: 95%; white-space: pre-wrap">{{ p.resposta }}</div>
          <q-expansion-item v-if="p.citacoes.length" dense dense-toggle switch-toggle-side class="text-caption text-grey-8" :label="`Fontes no edital (${p.citacoes.length})`">
            <div v-for="(c, i) in p.citacoes" :key="i" class="q-pl-lg q-py-xs">
              <b>[{{ i + 1 }}]</b> {{ c.documento }}<span v-if="c.pagina">, {{ c.pagina }}</span>
              <div class="text-italic text-grey-7">“{{ c.trecho }}”</div>
            </div>
          </q-expansion-item>
        </div>
        <div v-if="perguntando" class="row items-center q-gutter-sm q-mb-md text-grey-7">
          <q-spinner-dots color="primary" size="28px" /> <span>Lendo o edital para responder...</span>
        </div>
        <div v-if="!estado.perguntas.length && !perguntando" class="q-gutter-xs q-mb-sm">
          <q-chip v-for="s in sugestoes" :key="s" clickable outline color="primary" @click="pergunta = s; perguntar()">{{ s }}</q-chip>
        </div>
        <q-input v-model="pergunta" outlined dense autogrow placeholder="Ex.: Quais atestados de capacidade técnica são exigidos?" :disable="perguntando"
          @keydown.enter.exact.prevent="perguntar">
          <template #append><q-btn round flat dense icon="send" color="primary" :disable="pergunta.trim().length < 3 || perguntando" @click="perguntar" /></template>
        </q-input>
        <div class="text-caption text-grey-6 q-mt-sm">
          Respostas geradas por IA a partir dos arquivos publicados no PNCP. Confira sempre no edital antes de decidir.
        </div>
      </q-card-section>
    </template>
  </q-card>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Notify } from 'quasar';
import { api } from 'boot/axios';

const props = defineProps({ oportunidadeId: { type: [Number, String], required: true }, negocioId: { type: Number, default: null } });
const estado = ref(null);
const lendo = ref(false);
const perguntando = ref(false);
const addChecklist = ref(false);
const pergunta = ref('');
const etapa = ref(0);
let timer = null;
const etapas = ['Baixando o edital do PNCP...', 'Abrindo os arquivos e anexos...', 'Lendo o edital...', 'Montando o resumo...'];
const sugestoes = ['Precisa enviar amostra?', 'Quais atestados técnicos são exigidos?', 'Qual o prazo de entrega?', 'Tem cota para ME/EPP?', 'Como é feito o pagamento?'];
const GRUPOS = {
  juridica: 'Habilitação jurídica', fiscal_trabalhista: 'Regularidade fiscal e trabalhista',
  economico_financeira: 'Qualificação econômico-financeira', tecnica: 'Qualificação técnica', outros: 'Outros',
};

const r = computed(() => estado.value?.resumo ?? {});
const fatos = computed(() => [
  { nome: 'Sessão / abertura', valor: r.value.data_sessao },
  { nome: 'Onde é a disputa', valor: r.value.local_disputa },
  { nome: 'Critério de julgamento', valor: r.value.criterio_julgamento },
  { nome: 'Modo de disputa', valor: r.value.modo_disputa },
  { nome: 'Valor estimado', valor: r.value.valor_estimado },
  { nome: 'ME/EPP', valor: r.value.exclusivo_me_epp },
  { nome: 'Impugnação até', valor: r.value.prazo_impugnacao },
  { nome: 'Entrega / execução', valor: r.value.prazo_entrega_execucao },
  { nome: 'Pagamento', valor: r.value.condicoes_pagamento },
  { nome: 'Vigência', valor: r.value.vigencia },
  { nome: 'Garantias', valor: r.value.garantias },
  { nome: 'Penalidades', valor: r.value.penalidades },
].filter((c) => c.valor));
const docsPorGrupo = computed(() => (r.value.documentos_habilitacao ?? []).reduce((acc, d) => ((acc[d.grupo] ??= []).push(d), acc), {}));

async function carregar() {
  estado.value = (await api.get(`/oportunidades/${props.oportunidadeId}/edital`)).data;
}

async function resumir() {
  lendo.value = true;
  etapa.value = 0;
  timer = setInterval(() => { if (etapa.value < etapas.length - 1) etapa.value++; }, 12000);
  try {
    const { data } = await api.post(`/oportunidades/${props.oportunidadeId}/edital/resumo`, {}, { timeout: 300000 });
    Object.assign(estado.value, { resumo: data.resumo, arquivos: data.arquivos, ignorados: data.ignorados });
  } finally {
    clearInterval(timer);
    lendo.value = false;
  }
}

async function perguntar() {
  const texto = pergunta.value.trim();
  if (texto.length < 3 || perguntando.value) return;
  perguntando.value = true;
  try {
    const { data } = await api.post(`/oportunidades/${props.oportunidadeId}/edital/perguntas`, { pergunta: texto }, { timeout: 300000 });
    estado.value.perguntas.push(data);
    pergunta.value = '';
    if (!estado.value.arquivos.length) carregar();
  } finally {
    perguntando.value = false;
  }
}

async function adicionarChecklist() {
  addChecklist.value = true;
  try {
    for (const d of r.value.documentos_habilitacao) {
      await api.post(`/negocios/${props.negocioId}/checklist`, { texto: `Documento: ${d.descricao}`.slice(0, 500) });
    }
    Notify.create({ type: 'positive', message: 'Documentos adicionados ao checklist do negócio.' });
  } finally {
    addChecklist.value = false;
  }
}

onMounted(carregar);
onBeforeUnmount(() => clearInterval(timer));
</script>
