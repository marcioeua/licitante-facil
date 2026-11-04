<template>
  <q-card flat bordered class="lf-card">
    <q-card-section class="row items-center no-wrap q-pb-sm">
      <q-icon name="speed" color="primary" size="24px" class="q-mr-sm" />
      <div class="col">
        <div class="text-h6">{{ titulo }}</div>
        <div v-if="d?.ente && d.ente.nome !== titulo" class="text-caption text-grey-7">{{ d.ente.nome }}</div>
      </div>
    </q-card-section>

    <q-card-section v-if="!d" class="q-pt-none"><q-skeleton height="70px" /></q-card-section>

    <template v-else>
      <q-card-section class="q-pt-none">
        <div class="row items-center q-col-gutter-md no-wrap">
          <div class="col-auto">
            <div class="column items-center justify-center text-white" :class="`bg-${cor.bg}`"
              style="width: 72px; height: 72px; border-radius: 16px">
              <div class="text-h5 text-weight-bold" style="line-height: 1">{{ d.capag && /^[A-D]/.test(d.capag) ? d.capag : '—' }}</div>
              <div style="font-size: 10px">CAPAG</div>
            </div>
          </div>
          <div class="col">
            <q-badge :color="cor.bg" class="q-mb-xs text-weight-medium" :label="cor.rotulo" />
            <div class="text-body2">{{ d.texto }}</div>
          </div>
        </div>
      </q-card-section>

      <q-card-section v-if="d.indicadores" class="q-pt-none">
        <div class="row q-col-gutter-sm">
          <div v-for="i in d.indicadores" :key="i.nome" class="col-12 col-sm-4">
            <div class="bg-grey-2 q-pa-sm" style="border-radius: 8px">
              <div class="row items-center no-wrap">
                <div class="col text-caption text-grey-8">{{ i.nome }}</div>
                <q-badge :color="corNota(i.nota)" :label="i.nota ?? 'n.d.'" />
              </div>
              <div class="text-caption text-grey-6">{{ i.ajuda }}</div>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-card-section class="q-pt-none text-caption text-grey-7">
        <div v-if="d.observacao" class="q-mb-xs"><q-icon name="info" /> {{ d.observacao }}</div>
        <div v-if="d.informacaoFragil" class="q-mb-xs text-orange-9"><q-icon name="warning" /> A qualidade da informação contábil deste ente é baixa ({{ d.qualidadeInformacao }}), então a nota pode não refletir a realidade.</div>
        Indicador de risco baseado na Capacidade de Pagamento (CAPAG) do Tesouro Nacional, não no prazo real de cada pagamento.
        <span v-if="d.referencia">Base: {{ d.referencia }}.</span>
        <a :href="d.fonte" target="_blank" rel="noopener" class="text-primary">Fonte</a>
      </q-card-section>
    </template>
  </q-card>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from 'boot/axios';

const props = defineProps({
  oportunidadeId: { type: [Number, String], default: null },
  dados: { type: Object, default: null },
  titulo: { type: String, default: 'Este órgão costuma pagar em dia?' },
});
const carregado = ref(null);
const d = computed(() => props.dados ?? carregado.value);

const CORES = {
  baixo: { bg: 'positive', rotulo: 'Tende a pagar em dia' },
  medio: { bg: 'orange-8', rotulo: 'Atenção' },
  alto: { bg: 'negative', rotulo: 'Risco de atraso' },
  federal: { bg: 'primary', rotulo: 'Órgão federal' },
  indisponivel: { bg: 'grey-6', rotulo: 'Sem nota' },
};
const cor = computed(() => CORES[d.value?.nivel] ?? CORES.indisponivel);
const corNota = (n) => ({ A: 'positive', 'A+': 'positive', B: 'orange-8', 'B+': 'orange-7', C: 'negative', D: 'negative' }[n] ?? 'grey-6');

async function carregar() {
  if (props.oportunidadeId && !props.dados) {
    carregado.value = (await api.get(`/oportunidades/${props.oportunidadeId}/pagometro`)).data;
  }
}
onMounted(carregar);
watch(() => props.oportunidadeId, carregar);
</script>
