<template>
  <q-page padding>
    <div class="row items-center q-mb-md q-gutter-sm">
      <div class="text-h5 text-weight-bold col">Documentos</div>
      <q-select v-model="empresaFiltro" :options="filtros.empresas" option-value="id" option-label="razao_social" emit-value map-options
        outlined dense clearable label="Empresa" style="min-width: 220px" @update:model-value="carregar" />
      <q-btn unelevated no-caps color="primary" icon="upload_file" label="Adicionar documento" @click="abrirNovo()" />
    </div>

    <q-table flat bordered class="lf-card" :rows="docs" :columns="colunas" row-key="id" :pagination="{ rowsPerPage: 25 }"
      no-data-label="Nenhum documento. Adicione certidões, contrato social e atestados para não perder prazos.">
      <template #body-cell-status="p">
        <q-td :props="p"><q-badge :color="status[p.value].cor" :label="status[p.value].nome" /></q-td>
      </template>
      <template #body-cell-acoes="p">
        <q-td :props="p" class="text-right">
          <q-btn v-if="p.row.arquivo_nome" flat round dense icon="download" :href="`/api/documentos/${p.row.id}/arquivo`" />
          <q-btn flat round dense icon="edit" @click="editar(p.row)" />
          <q-btn flat round dense icon="delete" color="negative" @click="remover(p.row)" />
        </q-td>
      </template>
    </q-table>

    <q-dialog v-model="dialogo">
      <q-card style="width: 460px; max-width: 95vw">
        <q-card-section class="text-h6">{{ form.id ? 'Editar documento' : 'Novo documento' }}</q-card-section>
        <q-form @submit="salvar">
          <q-card-section class="q-gutter-md">
            <q-file v-if="!form.id" v-model="form.arquivo" outlined label="Arquivo (PDF, imagem, DOC...)" max-file-size="26214400"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.odt,.zip" @update:model-value="(f) => !form.nome && f && (form.nome = f.name.replace(/\.[^.]+$/, ''))">
              <template #prepend><q-icon name="attach_file" /></template>
            </q-file>
            <q-input v-model="form.nome" outlined label="Nome" :rules="[(v) => !!v || 'Obrigatório']" />
            <q-select v-model="form.categoria" :options="categorias" emit-value map-options outlined label="Tipo" />
            <q-input v-model="form.validade" outlined type="date" label="Validade" stack-label hint="Avisamos quando estiver perto de vencer" />
            <q-select v-model="form.empresa_id" :options="filtros.empresas" option-value="id" option-label="razao_social" emit-value map-options
              outlined clearable label="Empresa" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="Cancelar" v-close-popup />
            <q-btn type="submit" unelevated no-caps color="primary" label="Salvar" :loading="salvando" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useFiltros } from 'stores/filtros';
import { CATEGORIAS_DOC, data } from 'src/format';

const $q = useQuasar();
const filtros = useFiltros();
const docs = ref([]);
const empresaFiltro = ref(null);
const dialogo = ref(false);
const salvando = ref(false);
const form = reactive({});
const categorias = Object.entries(CATEGORIAS_DOC).map(([value, label]) => ({ value, label }));
const status = {
  valido: { nome: 'Válido', cor: 'positive' },
  vencendo: { nome: 'Vence em breve', cor: 'warning' },
  vencido: { nome: 'Vencido', cor: 'negative' },
  sem_validade: { nome: 'Sem validade', cor: 'grey-6' },
};
const colunas = [
  { name: 'nome', label: 'Documento', field: 'nome', align: 'left', sortable: true },
  { name: 'categoria', label: 'Tipo', field: (r) => CATEGORIAS_DOC[r.categoria], align: 'left', sortable: true },
  { name: 'empresa', label: 'Empresa', field: 'empresa_nome', align: 'left' },
  { name: 'validade', label: 'Validade', field: 'validade', format: data, sortable: true },
  { name: 'status', label: 'Situação', field: 'status' },
  { name: 'acoes', label: '', field: 'id' },
];

async function carregar() {
  docs.value = (await api.get('/documentos', { params: empresaFiltro.value ? { empresa_id: empresaFiltro.value } : {} })).data;
}
function abrirNovo(categoria = 'outros') {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, { nome: CATEGORIAS_DOC[categoria] && categoria !== 'outros' ? CATEGORIAS_DOC[categoria] : '', categoria: CATEGORIAS_DOC[categoria] ? categoria : 'outros', validade: '', empresa_id: empresaFiltro.value, arquivo: null });
  dialogo.value = true;
}
function editar(d) {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, { id: d.id, nome: d.nome, categoria: d.categoria, validade: d.validade ?? '', empresa_id: d.empresa_id });
  dialogo.value = true;
}
async function salvar() {
  salvando.value = true;
  try {
    if (form.id) {
      await api.patch(`/documentos/${form.id}`, {
        nome: form.nome, categoria: form.categoria, validade: form.validade || null, empresa_id: form.empresa_id ?? null,
      });
    } else {
      const fd = new FormData();
      fd.append('nome', form.nome);
      fd.append('categoria', form.categoria);
      if (form.validade) fd.append('validade', form.validade);
      if (form.empresa_id) fd.append('empresa_id', form.empresa_id);
      if (form.arquivo) fd.append('arquivo', form.arquivo);
      await api.post('/documentos', fd);
    }
    dialogo.value = false;
    carregar();
  } finally {
    salvando.value = false;
  }
}
function remover(d) {
  $q.dialog({ title: 'Excluir documento', message: `Excluir "${d.nome}"?`, cancel: true, ok: { color: 'negative', label: 'Excluir' } })
    .onOk(async () => {
      await api.delete(`/documentos/${d.id}`);
      carregar();
    });
}
const route = useRoute();
onMounted(async () => {
  await Promise.all([carregar(), filtros.carregarEmpresas()]);
  // Veio do quadro de habilitação: já abre o cadastro com o tipo de documento que falta.
  if (route.query.novo) abrirNovo(String(route.query.novo));
});
</script>
