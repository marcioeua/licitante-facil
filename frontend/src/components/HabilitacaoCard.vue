<template>
  <q-card flat bordered class="lf-card">
    <q-card-section class="row items-center q-pb-sm">
      <q-icon name="verified_user" color="primary" size="24px" class="q-mr-sm" />
      <div class="col">
        <div class="text-h6">Habilitação: estou apto?</div>
        <div class="text-caption text-grey-7">Documentos exigidos no edital x documentos cadastrados em Documentos, na data da sessão.</div>
      </div>
      <q-btn flat round dense icon="refresh" :loading="carregando" @click="carregar"><q-tooltip>Conferir de novo</q-tooltip></q-btn>
    </q-card-section>

    <q-card-section v-if="!h" class="q-pt-none"><q-skeleton height="60px" /></q-card-section>
    <q-card-section v-else-if="!oportunidadeId" class="q-pt-none text-grey-7">Este negócio não está ligado a uma licitação do PNCP.</q-card-section>
    <q-card-section v-else-if="!h.lido" class="q-pt-none">
      <div class="text-body2 text-grey-8 q-mb-sm">A IA ainda não leu o edital desta licitação. Ela lê e lista os documentos exigidos (1 a 2 minutos).</div>
      <q-btn unelevated no-caps color="primary" icon="auto_awesome" label="Ler edital e conferir documentação" :loading="lendo" @click="ler" />
    </q-card-section>
    <template v-else>
      <q-card-section class="q-pt-none">
        <q-banner rounded dense :class="h.apto ? 'bg-green-1 text-green-10' : 'bg-orange-1 text-orange-10'">
          <template #avatar><q-icon :name="h.apto ? 'check_circle' : 'warning'" /></template>
          <b v-if="!h.itens.length">A IA não achou a lista de documentos no edital: confira manualmente.</b>
          <b v-else-if="h.apto">Você está apto: a documentação exigida está em dia na data da sessão ({{ data(h.dataSessao) }}).</b>
          <span v-else><b>Ainda não está apto:</b> {{ h.pendentes }} documento(s) para resolver<span v-if="h.contagem.conferir"> e {{ h.contagem.conferir }} exigência(s) para conferir</span>.</span>
        </q-banner>
      </q-card-section>
      <q-list dense separator>
        <q-item v-for="(i, k) in h.itens" :key="k">
          <q-item-section avatar><q-icon :name="ICONE[i.situacao].icone" :color="ICONE[i.situacao].cor" /></q-item-section>
          <q-item-section>
            <q-item-label class="text-body2">{{ i.descricao }}</q-item-label>
            <q-item-label caption>
              <span :class="`text-${ICONE[i.situacao].cor}`">{{ ICONE[i.situacao].texto }}</span>
              <span v-if="i.documento"> · {{ i.documento.nome }}{{ i.documento.validade ? ` (válido até ${data(i.documento.validade)})` : '' }}</span>
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
      <q-card-actions>
        <q-btn flat no-caps color="primary" icon="folder_shared" label="Cadastrar ou atualizar documentos" :to="{ name: 'documentos' }" />
      </q-card-actions>
    </template>
  </q-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from 'boot/axios';
import { data } from 'src/format';

const props = defineProps({ negocioId: { type: Number, required: true }, oportunidadeId: { type: Number, default: null } });
const ICONE = {
  ok: { icone: 'check_circle', cor: 'positive', texto: 'Em dia' },
  vence: { icone: 'schedule', cor: 'orange-8', texto: 'Vence antes da sessão: renove' },
  vencido: { icone: 'event_busy', cor: 'negative', texto: 'Vencido: renove' },
  falta: { icone: 'cancel', cor: 'negative', texto: 'Falta cadastrar' },
  declaracao: { icone: 'draw', cor: 'grey-7', texto: 'Declaração: preencher/assinar na hora (no portal)' },
  conferir: { icone: 'help', cor: 'grey-7', texto: 'Confira manualmente' },
};
const h = ref(null);
const carregando = ref(false);
const lendo = ref(false);

async function carregar() {
  carregando.value = true;
  try {
    h.value = (await api.get(`/habilitacao/negocio/${props.negocioId}`)).data;
  } finally {
    carregando.value = false;
  }
}
async function ler() {
  lendo.value = true;
  try {
    await api.post(`/oportunidades/${props.oportunidadeId}/edital/resumo`, {}, { timeout: 600000 });
    await carregar();
  } finally {
    lendo.value = false;
  }
}
onMounted(carregar);
</script>
