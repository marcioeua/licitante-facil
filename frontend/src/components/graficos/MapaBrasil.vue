<template>
  <!-- Mapa coroplético: magnitude por estado em um único tom (claro = pouco, escuro = muito). -->
  <div>
    <svg :viewBox="mapa.viewBox" class="mb-svg" role="img" :aria-label="titulo">
      <path v-for="uf in mapa.locations" :key="uf.id" :d="uf.path" class="mb-uf" :class="{ 'mb-sel': selecionadas.includes(uf.id.toUpperCase()) }"
        :fill="cor(uf.id)" @click="$emit('escolher', uf.id.toUpperCase())">
        <q-tooltip class="bg-grey-10 text-body2">
          <div class="text-weight-medium">{{ uf.name }}</div>
          <div>{{ dados[uf.id.toUpperCase()] != null ? formatar(dados[uf.id.toUpperCase()]) : 'Sem contratos' }}</div>
        </q-tooltip>
      </path>
    </svg>
    <div class="row items-center no-wrap q-mt-sm text-caption text-grey-7">
      <span class="q-mr-xs">Menos</span>
      <span v-for="c in RAMPA" :key="c" class="mb-escala" :style="{ background: c }" />
      <span class="q-ml-xs">Mais</span>
      <q-space />
      <span class="text-grey-6" style="font-size: 10px">Mapa: svg-maps, CC BY 4.0</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import brasil from '@svg-maps/brazil';

const props = defineProps({
  dados: { type: Object, default: () => ({}) }, // { SP: valor, ... }
  formatar: { type: Function, default: (v) => String(v) },
  selecionadas: { type: Array, default: () => [] },
  titulo: { type: String, default: 'Mapa do Brasil por estado' },
});
defineEmits(['escolher']);
const mapa = brasil;
// Rampa sequencial de um só tom (azul da marca), do claro ao escuro.
const RAMPA = ['#dbe8fb', '#a8c8f3', '#6ea3e6', '#2f74d0', '#1a4f9c'];
const SEM_DADOS = '#f1f0ed';

// Escala por quantis: distribuição desigual entre estados (SP sozinho costuma ser muito maior).
const limites = computed(() => {
  const v = Object.values(props.dados).filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
});
function cor(id) {
  const v = props.dados[id.toUpperCase()];
  if (!v) return SEM_DADOS;
  const i = limites.value.findIndex((l) => v <= l);
  return RAMPA[i === -1 ? RAMPA.length - 1 : i];
}
</script>

<style scoped>
.mb-svg { width: 100%; max-height: 380px; display: block; }
.mb-uf { stroke: #ffffff; stroke-width: 1.2; cursor: pointer; transition: opacity 0.15s; }
.mb-uf:hover { opacity: 0.8; }
.mb-sel { stroke: #0b0b0b; stroke-width: 2; }
.mb-escala { width: 22px; height: 10px; display: inline-block; margin-right: 2px; border-radius: 2px; }
</style>
