<template>
  <!-- Partes de um todo (poucas categorias): barra 100% empilhada com 2px de espaço entre partes,
       cor fixa por categoria e legenda sempre visível com o percentual (identidade não depende só da cor). -->
  <div :aria-label="titulo" role="img">
    <div class="bp-barra">
      <div v-for="p in visiveis" :key="p.chave" class="bp-seg" :style="{ flexGrow: p.valor, background: cor(p.chave) }">
        <q-tooltip class="bg-grey-10 text-body2">{{ p.rotulo }}: {{ pct(p.valor / total) }} · {{ formatar(p.valor) }}</q-tooltip>
      </div>
    </div>
    <div class="row q-col-gutter-sm q-mt-sm">
      <div v-for="p in partes" :key="p.chave" class="col-auto row items-center no-wrap text-body2">
        <span class="bp-ponto q-mr-xs" :style="{ background: cor(p.chave) }" aria-hidden="true" />
        <span class="text-grey-9">{{ p.rotulo }}</span>
        <span class="text-weight-medium q-ml-xs">{{ pct(p.valor / total) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  partes: { type: Array, default: () => [] }, // [{ chave, rotulo, valor }]
  cores: { type: Object, required: true }, // chave -> cor fixa (a cor segue a categoria, nunca a posição)
  formatar: { type: Function, default: (v) => String(v) },
  titulo: { type: String, default: '' },
});
const total = computed(() => props.partes.reduce((a, p) => a + p.valor, 0) || 1);
const visiveis = computed(() => props.partes.filter((p) => p.valor / total.value >= 0.002));
const cor = (k) => props.cores[k] ?? '#8a8984';
const pct = (v) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`;
</script>

<style scoped>
.bp-barra { display: flex; gap: 2px; height: 20px; border-radius: 4px; overflow: hidden; background: #f1f0ed; }
.bp-seg { min-width: 3px; }
.bp-ponto { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
</style>
