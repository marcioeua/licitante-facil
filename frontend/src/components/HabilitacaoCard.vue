<template>
  <q-card flat bordered class="lf-card">
    <q-card-section class="row items-center q-pb-sm">
      <q-icon name="verified_user" color="primary" size="24px" class="q-mr-sm" />
      <div class="col">
        <div class="text-h6">Habilitação: estou apto?</div>
        <div class="text-caption text-grey-7">Documentos exigidos no edital x documentos cadastrados em Documentos, na data da sessão.</div>
      </div>
      <q-btn flat round dense icon="refresh" :loading="carregando" aria-label="Conferir de novo" @click="conferirDeNovo"><q-tooltip>Conferir de novo com os documentos cadastrados</q-tooltip></q-btn>
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
        <div class="text-caption text-grey-6 q-mt-xs">Conferido às {{ hora(h.conferidoEm) }}. Cadastrou um documento? Toque em <q-icon name="refresh" /> para conferir de novo.</div>
      </q-card-section>
      <q-list dense separator>
        <q-item v-for="(i, k) in h.itens" :key="k">
          <q-item-section avatar><q-icon :name="ICONE[i.situacao].icone" :color="ICONE[i.situacao].cor" /></q-item-section>
          <q-item-section>
            <q-item-label class="text-body2">{{ i.descricao }}</q-item-label>
            <q-item-label caption>
              <span :class="`text-${ICONE[i.situacao].cor}`">{{ i.situacao === 'manual' ? (i.ajuste === 'nao_se_aplica' ? 'Marcado por você: não se aplica' : 'Marcado por você: já tenho') : ICONE[i.situacao].texto }}</span>
              <span v-if="i.situacao !== 'manual' && i.documento && i.situacao === 'ok'"> · {{ i.documento.nome }}{{ i.documento.validade ? ` (válido até ${data(i.documento.validade)})` : '' }}</span>
            </q-item-label>
            <q-item-label v-if="['falta', 'vencido', 'vence'].includes(i.situacao)" caption class="q-mt-xs">
              <template v-for="f in faltando(i)" :key="f.categoria">
                <q-btn dense outline no-caps size="sm" :color="f.situacao === 'falta' ? 'negative' : 'orange-8'" class="q-mr-xs q-mb-xs"
                  :icon="f.situacao === 'falta' ? 'add' : 'autorenew'" :label="`${f.situacao === 'falta' ? 'Cadastrar' : 'Renovar'}: ${CATEGORIAS_DOC[f.categoria] ?? f.categoria}`"
                  :to="{ name: 'documentos', query: { novo: f.categoria } }" />
              </template>
              <span v-if="i.qualquer" class="text-grey-7">(basta um deles)</span>
            </q-item-label>
          </q-item-section>
          <q-item-section side top>
            <q-btn flat round dense size="sm" icon="more_vert" color="grey-7" aria-label="Opções">
              <q-menu auto-close>
                <q-list dense style="min-width: 220px">
                  <q-item v-if="i.situacao !== 'manual'" clickable @click="ajustar(i, 'ok')"><q-item-section avatar><q-icon name="check" color="positive" /></q-item-section><q-item-section>Já tenho este documento</q-item-section></q-item>
                  <q-item v-if="i.situacao !== 'manual'" clickable @click="ajustar(i, 'nao_se_aplica')"><q-item-section avatar><q-icon name="block" color="grey-7" /></q-item-section><q-item-section>Não se aplica à minha empresa</q-item-section></q-item>
                  <q-item v-else clickable @click="ajustar(i, null)"><q-item-section avatar><q-icon name="undo" /></q-item-section><q-item-section>Desfazer (conferir pelo sistema)</q-item-section></q-item>
                </q-list>
              </q-menu>
            </q-btn>
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
import { Notify } from 'quasar';
import { api } from 'boot/axios';
import { data, CATEGORIAS_DOC } from 'src/format';

const props = defineProps({ negocioId: { type: Number, required: true }, oportunidadeId: { type: Number, default: null } });
const ICONE = {
  ok: { icone: 'check_circle', cor: 'positive', texto: 'Em dia' },
  vence: { icone: 'schedule', cor: 'orange-8', texto: 'Vence antes da sessão: renove' },
  vencido: { icone: 'event_busy', cor: 'negative', texto: 'Vencido: renove' },
  falta: { icone: 'cancel', cor: 'negative', texto: 'Falta cadastrar' },
  declaracao: { icone: 'draw', cor: 'grey-7', texto: 'Declaração: preencher/assinar na hora (no portal)' },
  conferir: { icone: 'help', cor: 'grey-7', texto: 'Confira manualmente' },
  manual: { icone: 'task_alt', cor: 'teal-8', texto: 'Marcado por você' },
};
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
// Documentos que faltam numa exigência (pode pedir vários: "CND federal, FGTS e CNDT").
const faltando = (i) => (i.faltam?.length ? i.faltam : i.categoria ? [{ categoria: i.categoria, situacao: i.situacao }] : []);
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
async function conferirDeNovo() {
  const antes = h.value?.pendentes;
  await carregar();
  if (!h.value?.lido) return;
  const mudou = antes != null && antes !== h.value.pendentes;
  Notify.create({
    type: h.value.apto ? 'positive' : 'info',
    message: h.value.apto ? 'Conferido de novo: você está apto!'
      : `Conferido de novo: ${h.value.pendentes} documento(s) para resolver${mudou ? ` (antes eram ${antes})` : ' — nada mudou desde a última conferência'}.`,
    timeout: 3500,
  });
}
async function ajustar(i, situacao) {
  h.value = (await api.put(`/habilitacao/negocio/${props.negocioId}/ajuste`, { descricao: i.descricao, situacao })).data;
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
