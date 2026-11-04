<template>
  <q-page padding>
    <div class="row items-center q-mb-md q-gutter-sm">
      <div class="text-h5 text-weight-bold col">Empresas</div>
      <q-btn unelevated no-caps color="primary" icon="add" label="Nova empresa" @click="abrir()" />
    </div>
    <q-list bordered separator class="lf-card bg-white">
      <q-item v-for="e in filtros.empresas" :key="e.id">
        <q-item-section avatar><q-avatar color="blue-1" text-color="primary" icon="business" /></q-item-section>
        <q-item-section>
          <q-item-label>{{ e.razao_social }}</q-item-label>
          <q-item-label caption>CNPJ {{ cnpj(e.cnpj) }}</q-item-label>
        </q-item-section>
        <q-item-section side class="row no-wrap">
          <div>
            <q-btn flat round icon="insights" :to="{ name: 'mercado', query: { empresa: e.cnpj } }"><q-tooltip>Minha empresa no mercado</q-tooltip></q-btn>
            <q-btn flat round icon="folder_shared" :to="{ name: 'documentos' }"><q-tooltip>Documentos</q-tooltip></q-btn>
            <q-btn flat round icon="edit" @click="abrir(e)" />
            <q-btn flat round icon="delete" color="negative" @click="remover(e)" />
          </div>
        </q-item-section>
      </q-item>
      <q-item v-if="!filtros.empresas.length"><q-item-section class="text-grey-7">Cadastre as empresas (CNPJs) que participam das licitações.</q-item-section></q-item>
    </q-list>

    <q-dialog v-model="dialogo">
      <q-card style="width: 420px; max-width: 95vw">
        <q-card-section class="text-h6">{{ form.id ? 'Editar empresa' : 'Nova empresa' }}</q-card-section>
        <q-form @submit="salvar">
          <q-card-section class="q-gutter-md">
            <q-input v-model="form.razao_social" outlined label="Razão social" :rules="[(v) => v?.length >= 2 || 'Obrigatório']" />
            <q-input v-model="form.cnpj" outlined label="CNPJ" mask="##.###.###/####-##" unmasked-value
              :rules="[(v) => v?.length === 14 || 'CNPJ incompleto']" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="Cancelar" v-close-popup />
            <q-btn type="submit" unelevated no-caps color="primary" label="Salvar" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useFiltros } from 'stores/filtros';
import { cnpj } from 'src/format';

const $q = useQuasar();
const filtros = useFiltros();
const dialogo = ref(false);
const form = reactive({});

function abrir(e) {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, e ? { ...e } : { razao_social: '', cnpj: '' });
  dialogo.value = true;
}
async function salvar() {
  const body = { razao_social: form.razao_social, cnpj: form.cnpj };
  if (form.id) await api.put(`/empresas/${form.id}`, body);
  else await api.post('/empresas', body);
  dialogo.value = false;
  filtros.carregarEmpresas();
}
function remover(e) {
  $q.dialog({ title: 'Excluir empresa', message: `Excluir ${e.razao_social}? Os documentos dela também serão excluídos.`, cancel: true, ok: { color: 'negative', label: 'Excluir' } })
    .onOk(async () => {
      await api.delete(`/empresas/${e.id}`);
      filtros.carregarEmpresas();
    });
}
onMounted(() => filtros.carregarEmpresas());
</script>
