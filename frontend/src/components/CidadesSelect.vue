<template>
  <q-select :model-value="modelValue" :options="opcoes" option-value="valor" option-label="nome" emit-value map-options
    multiple use-input use-chips input-debounce="250" outlined :dense="dense" :label="label" options-dense
    @filter="filtrar" @update:model-value="(v) => $emit('update:modelValue', v)">
    <template #selected-item="s">
      <q-chip removable dense :tabindex="s.tabindex" class="q-ma-xs" @remove="s.removeAtIndex(s.index)">
        {{ rotulo(s.opt) }}
      </q-chip>
    </template>
    <template #option="{ itemProps, opt }">
      <q-item v-bind="itemProps">
        <q-item-section>{{ opt.nome }}</q-item-section>
        <q-item-section side class="text-caption">{{ opt.total }} aberta(s)</q-item-section>
      </q-item>
    </template>
    <template #no-option>
      <q-item><q-item-section class="text-grey-7">Digite o nome da cidade</q-item-section></q-item>
    </template>
  </q-select>
</template>

<script setup>
import { ref } from 'vue';
import { api } from 'boot/axios';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  ufs: { type: Array, default: () => [] },
  label: { type: String, default: 'Cidades' },
  dense: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);
const opcoes = ref([]);

// Valor "UF:Município" -> "Município/UF"
const rotulo = (v) => {
  const s = typeof v === 'string' ? v : v?.valor ?? '';
  const i = s.indexOf(':');
  return i > 0 ? `${s.slice(i + 1)}/${s.slice(0, i)}` : s;
};

function filtrar(texto, atualizar) {
  api.get('/oportunidades/municipios', { params: { q: texto, uf: props.ufs.join(',') } })
    .then(({ data }) => atualizar(() => {
      // Mantém as já selecionadas na lista para o chip continuar com nome.
      const sel = props.modelValue.filter((v) => !data.some((d) => d.valor === v)).map((v) => ({ valor: v, nome: rotulo(v), total: '' }));
      opcoes.value = [...data, ...sel];
    }))
    .catch(() => atualizar(() => {}));
}
</script>
