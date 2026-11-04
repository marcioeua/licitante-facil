<template>
  <!-- Ranking (magnitude): barras horizontais de um tom, valor escrito ao lado, clique opcional. -->
  <div role="list" :aria-label="titulo">
    <div v-if="!itens.length" class="text-grey-6 q-pa-sm">Sem dados.</div>
    <div v-for="it in itens.slice(0, limite)" :key="it.chave ?? it.rotulo" role="listitem" class="bh-linha"
      :class="{ 'cursor-pointer': clicavel }" @click="clicavel && $emit('escolher', it)">
      <div class="row no-wrap items-baseline q-mb-xs">
        <div class="col ellipsis text-body2" :title="it.rotulo">{{ it.rotulo }}</div>
        <div class="text-body2 text-weight-medium q-pl-sm" style="white-space: nowrap">{{ formatar(it.valor) }}</div>
      </div>
      <div class="bh-trilho">
        <div class="bh-barra" :style="{ width: Math.max(0.5, (it.valor / max) * 100) + '%' }" />
      </div>
      <div v-if="it.sub" class="text-caption text-grey-7 q-mt-xs">{{ it.sub }}</div>
      <q-tooltip v-if="it.dica" class="bg-grey-10 text-body2">{{ it.dica }}</q-tooltip>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  itens: { type: Array, default: () => [] }, // [{ chave?, rotulo, valor, sub?, dica? }]
  formatar: { type: Function, default: (v) => String(v) },
  limite: { type: Number, default: 10 },
  clicavel: { type: Boolean, default: false },
  titulo: { type: String, default: '' },
});
defineEmits(['escolher']);
const max = computed(() => Math.max(1e-9, ...props.itens.map((i) => i.valor)));
</script>

<style scoped>
.bh-linha { padding: 6px 4px; border-radius: 6px; }
.bh-linha.cursor-pointer:hover { background: #f1f5f9; }
.bh-trilho { height: 8px; background: #f1f0ed; border-radius: 4px; overflow: hidden; }
.bh-barra { height: 100%; background: var(--q-primary); border-radius: 0 4px 4px 0; }
</style>
