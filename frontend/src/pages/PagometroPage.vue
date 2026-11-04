<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-xs">Pagômetro</div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Consulte se uma prefeitura ou um estado tem boa capacidade de pagar os fornecedores em dia,
      pela nota CAPAG do Tesouro Nacional.
    </div>
    <q-input v-model="q" outlined clearable debounce="350" placeholder="Digite a cidade ou o estado. Ex.: Campinas, Ceará" class="q-mb-md" autofocus>
      <template #prepend><q-icon name="search" /></template>
    </q-input>
    <div v-if="carregando" class="q-pa-md"><q-spinner color="primary" /></div>
    <div v-else-if="q && q.length >= 2 && !resultados.length" class="text-grey-7 q-pa-md">Nenhum estado ou município encontrado.</div>
    <div class="row q-col-gutter-md">
      <div v-for="r in resultados" :key="r.ente.tipo + r.ente.codigo" class="col-12 col-md-6">
        <PagometroCard :dados="r" :titulo="r.ente.nome" />
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api } from 'boot/axios';
import PagometroCard from 'components/PagometroCard.vue';

const q = ref('');
const resultados = ref([]);
const carregando = ref(false);

watch(q, async (texto) => {
  if (!texto || texto.trim().length < 2) {
    resultados.value = [];
    return;
  }
  carregando.value = true;
  try {
    resultados.value = (await api.get('/pagometro', { params: { q: texto } })).data.slice(0, 10);
  } finally {
    carregando.value = false;
  }
});
</script>
