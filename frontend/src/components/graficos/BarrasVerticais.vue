<template>
  <!-- Série única (magnitude no tempo): um tom só, barras finas com ponta arredondada e dica ao passar o mouse. -->
  <div class="bv" :style="{ height: altura + 'px' }" role="img" :aria-label="titulo">
    <div v-if="!itens.length" class="bv-vazio text-grey-6">Sem dados no período.</div>
    <div v-else class="bv-area">
      <div class="bv-grade" aria-hidden="true">
        <div v-for="g in 3" :key="g" class="bv-linha" :style="{ bottom: (g / 3) * 100 + '%' }">
          <span class="bv-escala">{{ formatar((max * g) / 3) }}</span>
        </div>
      </div>
      <div class="bv-barras">
        <div v-for="(it, i) in itens" :key="it.rotulo" class="bv-col">
          <div class="bv-alvo">
            <div class="bv-barra" :class="{ 'bv-parcial': it.parcial }" :style="{ height: Math.max(2, (it.valor / max) * 100) + '%' }" />
            <q-tooltip class="bg-grey-10 text-body2">
              <div class="text-weight-medium">{{ it.rotuloLongo ?? it.rotulo }}</div>
              <div>{{ formatar(it.valor) }}</div>
              <div v-if="it.detalhe" class="text-grey-5">{{ it.detalhe }}</div>
              <div v-if="it.parcial" class="text-amber-4">Em consolidação: o valor ainda deve crescer</div>
            </q-tooltip>
          </div>
          <div class="bv-rotulo text-caption text-grey-7">{{ mostrarRotulo(i) ? it.rotulo : '' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  itens: { type: Array, default: () => [] }, // [{ rotulo, rotuloLongo?, valor, detalhe? }]
  formatar: { type: Function, default: (v) => String(v) },
  altura: { type: Number, default: 200 },
  titulo: { type: String, default: '' },
});
const max = computed(() => Math.max(1, ...props.itens.map((i) => i.valor)));
// Rótulos seletivos: no máximo ~8 no eixo.
const passo = computed(() => Math.max(1, Math.ceil(props.itens.length / 8)));
const mostrarRotulo = (i) => i % passo.value === 0 || i === props.itens.length - 1;
</script>

<style scoped>
.bv { position: relative; width: 100%; }
.bv-vazio { display: flex; align-items: center; justify-content: center; height: 100%; }
.bv-area { position: relative; height: 100%; padding-left: 64px; }
.bv-grade { position: absolute; inset: 0 0 22px 64px; pointer-events: none; }
.bv-linha { position: absolute; left: 0; right: 0; border-top: 1px solid #eceae6; }
.bv-escala { position: absolute; right: calc(100% + 8px); top: -8px; font-size: 11px; color: #6b6a66; white-space: nowrap; }
.bv-barras { position: absolute; inset: 0 0 0 64px; display: flex; align-items: stretch; gap: 2px; border-bottom: 1px solid #c9c7c1; padding-bottom: 22px; }
.bv-col { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
.bv-alvo { flex: 1; display: flex; align-items: flex-end; justify-content: center; cursor: default; }
.bv-alvo:hover .bv-barra { background: #1e40af; }
.bv-barra { width: min(28px, 70%); background: var(--q-primary); border-radius: 4px 4px 0 0; transition: background 0.15s; }
.bv-parcial { background: repeating-linear-gradient(135deg, #8fb0ea 0 4px, #c6d6f4 4px 8px); }
.bv-rotulo { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); white-space: nowrap; }
</style>
