<template>
  <q-dialog :model-value="modelValue" maximized-on-mobile @update:model-value="(v) => $emit('update:modelValue', v)">
    <q-card style="width: 760px; max-width: 95vw">
      <q-card-section class="row items-center">
        <div class="col text-h6">{{ titulo }}</div>
        <q-btn-toggle v-model="ordem" no-caps unelevated dense toggle-color="primary" color="grey-2" text-color="grey-9" class="q-mr-sm"
          :options="[{ label: 'Valor', value: 'valor' }, { label: 'Contratos', value: 'contratos' }]" />
        <q-btn flat round icon="close" v-close-popup />
      </q-card-section>
      <q-table flat :rows="dados?.itens ?? []" :columns="colunas" row-key="chave" :loading="carregando"
        v-model:pagination="paginacao" :rows-number="dados?.total ?? 0" :rows-per-page-options="[25, 50, 100]" @request="aoPaginar"
        no-data-label="Sem dados para este filtro.">
        <template #body-cell-nome="p">
          <q-td :props="p" style="white-space: normal">
            <a v-if="tipo === 'fornecedor' || tipo === 'uf'" href="#" class="text-primary" @click.prevent="$emit('escolher', p.row)">{{ p.value }}</a>
            <span v-else>{{ p.value }}</span>
          </q-td>
        </template>
      </q-table>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { api } from 'boot/axios';
import { brl } from 'src/format';

const props = defineProps({
  modelValue: Boolean,
  tipo: { type: String, required: true }, // uf | municipio | orgao | fornecedor | categoria
  titulo: { type: String, default: '' },
  filtros: { type: Object, default: () => ({}) },
});
defineEmits(['update:modelValue', 'escolher']);
const dados = ref(null);
const carregando = ref(false);
const ordem = ref('valor');
const paginacao = ref({ page: 1, rowsPerPage: 25, rowsNumber: 0 });
const pct = (v) => `${((v ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: v < 0.1 ? 2 : 1 })}%`;
const DETALHE = { orgao: 'UF', municipio: 'UF', fornecedor: 'Clientes' };
const colunas = computed(() => [
  { name: 'pos', label: '#', field: (r) => (dados.value?.itens.indexOf(r) ?? 0) + 1 + (paginacao.value.page - 1) * paginacao.value.rowsPerPage, align: 'left' },
  { name: 'nome', label: { uf: 'Estado', municipio: 'Município', orgao: 'Órgão', fornecedor: 'Fornecedor', categoria: 'Categoria' }[props.tipo], field: 'nome', align: 'left' },
  ...(DETALHE[props.tipo] ? [{ name: 'detalhe', label: DETALHE[props.tipo], field: 'detalhe' }] : []),
  { name: 'contratos', label: 'Contratos', field: 'contratos', format: (v) => Number(v).toLocaleString('pt-BR') },
  { name: 'valor', label: 'Valor', field: 'valor', format: brl },
  { name: 'participacao', label: 'Fatia', field: 'participacao', format: pct },
]);

async function carregar() {
  carregando.value = true;
  try {
    dados.value = (await api.get(`/mercado/ranking/${props.tipo}`, {
      params: { ...props.filtros, ordem: ordem.value, pagina: paginacao.value.page, tamanho: paginacao.value.rowsPerPage },
    })).data;
    paginacao.value.rowsNumber = dados.value.total;
  } finally {
    carregando.value = false;
  }
}
function aoPaginar({ pagination }) {
  paginacao.value = { ...paginacao.value, page: pagination.page, rowsPerPage: pagination.rowsPerPage };
  carregar();
}
watch(() => [props.modelValue, props.tipo], ([aberto]) => {
  if (aberto) { paginacao.value.page = 1; carregar(); }
});
watch(ordem, () => { paginacao.value.page = 1; carregar(); });
</script>
