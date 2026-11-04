<template>
  <q-page padding>
    <q-btn flat no-caps icon="arrow_back" label="Voltar" class="q-mb-sm" @click="$router.back()" />
    <q-skeleton v-if="!op" height="300px" />
    <q-card v-else flat bordered class="lf-card">
      <q-card-section>
        <div class="row q-gutter-xs q-mb-sm">
          <q-badge color="blue-1" text-color="primary" :label="op.modalidade" />
          <q-badge v-if="op.situacao" color="grey-3" text-color="grey-9" :label="op.situacao" />
          <q-badge v-if="op.registro_preco" color="teal-1" text-color="teal-9" label="Registro de preço" />
        </div>
        <div class="text-h6 text-objeto">{{ op.objeto }}</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <div class="row q-col-gutter-md">
          <div v-for="c in campos" :key="c.nome" class="col-12 col-sm-6 col-md-4">
            <div class="text-caption text-grey-7">{{ c.nome }}</div>
            <div class="text-body1">{{ c.valor || '—' }}</div>
          </div>
        </div>
      </q-card-section>
      <q-separator />
      <q-card-actions class="q-pa-md q-gutter-sm">
        <q-btn v-if="op.negocio_id" unelevated no-caps color="positive" icon="view_kanban" label="Abrir no funil" :to="{ name: 'negocio', params: { id: op.negocio_id } }" />
        <q-btn v-else unelevated no-caps color="primary" icon="add" label="Adicionar ao funil" :loading="salvando" @click="adicionar" />
        <q-btn v-if="op.link_pncp" outline no-caps color="primary" icon="open_in_new" label="Ver edital no PNCP" :href="op.link_pncp" target="_blank" rel="noopener" />
        <q-btn v-if="op.link_origem" flat no-caps color="primary" icon="launch" label="Sistema de origem" :href="op.link_origem" target="_blank" rel="noopener" />
      </q-card-actions>
    </q-card>
    <PagometroCard v-if="op" :oportunidade-id="op.id" class="q-mt-md" />
    <EditalIA v-if="op" :oportunidade-id="op.id" :negocio-id="op.negocio_id" class="q-mt-md" />
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'boot/axios';
import { brl, cnpj, dataHora } from 'src/format';
import EditalIA from 'components/EditalIA.vue';
import PagometroCard from 'components/PagometroCard.vue';

const route = useRoute();
const router = useRouter();
const op = ref(null);
const salvando = ref(false);
const campos = computed(() => [
  { nome: 'Órgão', valor: op.value.orgao_nome },
  { nome: 'CNPJ do órgão', valor: cnpj(op.value.orgao_cnpj) },
  { nome: 'Unidade', valor: op.value.unidade_nome },
  { nome: 'Local', valor: [op.value.municipio, op.value.uf].filter(Boolean).join(' / ') },
  { nome: 'Número da compra', valor: [op.value.numero_compra, op.value.ano_compra].filter(Boolean).join('/') },
  { nome: 'Modo de disputa', valor: op.value.modo_disputa },
  { nome: 'Valor estimado', valor: brl(op.value.valor_estimado) },
  { nome: 'Publicação', valor: dataHora(op.value.data_publicacao) },
  { nome: 'Início das propostas', valor: dataHora(op.value.data_abertura) },
  { nome: 'Fim das propostas', valor: dataHora(op.value.data_encerramento) },
  { nome: 'Nº de controle PNCP', valor: op.value.numero_controle_pncp },
]);

async function adicionar() {
  salvando.value = true;
  try {
    const { data } = await api.post('/negocios', { oportunidade_id: op.value.id });
    router.push({ name: 'negocio', params: { id: data.id } });
  } finally {
    salvando.value = false;
  }
}

onMounted(async () => {
  op.value = (await api.get(`/oportunidades/${route.params.id}`)).data;
});
</script>
