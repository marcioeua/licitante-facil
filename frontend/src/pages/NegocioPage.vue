<template>
  <q-page padding>
    <q-btn flat no-caps icon="arrow_back" label="Meus negócios" class="q-mb-sm" :to="{ name: 'negocios' }" />
    <q-skeleton v-if="!n" height="400px" />
    <div v-else class="row q-col-gutter-md">
      <div class="col-12 col-md-8 q-gutter-y-md">
        <q-card flat bordered class="lf-card">
          <q-card-section>
            <div class="row items-start no-wrap">
              <q-input v-model="form.titulo" borderless autogrow class="col text-h6" input-class="text-h6" @blur="salvar({ titulo: form.titulo })" />
              <q-btn flat round :icon="n.favorito ? 'star' : 'star_border'" color="amber" @click="salvar({ favorito: !n.favorito })" />
            </div>
            <div v-if="n.orgao_nome" class="text-grey-7">{{ n.orgao_nome }} · {{ n.municipio }}/{{ n.uf }} · {{ n.modalidade }}</div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <q-btn-toggle v-model="form.etapa" spread no-caps unelevated toggle-color="primary" color="grey-2" text-color="grey-9"
              :options="ETAPAS.map((e) => ({ label: e.nome, value: e.valor }))" @update:model-value="(v) => salvar({ etapa: v })" />
          </q-card-section>
          <q-card-section class="row q-col-gutter-md">
            <div class="col-12 col-sm-6">
              <q-select v-model="form.empresa_id" :options="filtros.empresas" option-value="id" option-label="razao_social" emit-value map-options
                outlined dense clearable label="Empresa participante" @update:model-value="(v) => salvar({ empresa_id: v ?? null })">
                <template #no-option><q-item><q-item-section class="text-grey-7">Cadastre em Empresas</q-item-section></q-item></template>
              </q-select>
            </div>
            <div class="col-12 col-sm-6"><q-input v-model="form.responsavel" outlined dense label="Responsável" @blur="salvar({ responsavel: form.responsavel || null })" /></div>
            <div class="col-12 col-sm-6">
              <q-input v-model="form.data_disputa" outlined dense type="datetime-local" label="Data da disputa" stack-label
                @change="salvar({ data_disputa: form.data_disputa || null })" />
            </div>
            <div class="col-12 col-sm-6">
              <q-input v-model.number="form.valor_proposta" outlined dense type="number" label="Valor da sua proposta (R$)"
                @blur="salvar({ valor_proposta: form.valor_proposta === '' ? null : form.valor_proposta })" />
            </div>
            <div class="col-12">
              <q-input v-model="form.notas" outlined type="textarea" autogrow label="Anotações" @blur="salvar({ notas: form.notas || null })" />
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="lf-card">
          <q-card-section class="row items-center">
            <div class="text-h6 col">Checklist</div>
            <div class="text-grey-7">{{ n.checklist.filter((c) => c.feito).length }}/{{ n.checklist.length }}</div>
          </q-card-section>
          <q-list>
            <q-item v-for="c in n.checklist" :key="c.id" tag="label" dense>
              <q-item-section avatar><q-checkbox :model-value="!!c.feito" @update:model-value="(v) => marcar(c, v)" /></q-item-section>
              <q-item-section :class="{ 'text-strike text-grey-6': c.feito }">{{ c.texto }}</q-item-section>
              <q-item-section side><q-btn flat round dense size="sm" icon="close" @click.prevent="removerItem(c)" /></q-item-section>
            </q-item>
          </q-list>
          <q-card-section>
            <q-input v-model="novoItem" dense outlined placeholder="Adicionar tarefa e apertar Enter" @keyup.enter="addItem" />
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-4 q-gutter-y-md">
        <q-card v-if="n.oportunidade_id" flat bordered class="lf-card">
          <q-card-section class="text-h6 q-pb-none">Licitação</q-card-section>
          <q-list dense>
            <q-item><q-item-section><q-item-label caption>Valor estimado</q-item-label>{{ brl(n.valor_estimado) }}</q-item-section></q-item>
            <q-item><q-item-section><q-item-label caption>Propostas até</q-item-label>{{ dataHora(n.data_encerramento) }}</q-item-section></q-item>
            <q-item><q-item-section><q-item-label caption>Número</q-item-label>{{ n.numero_compra }}/{{ n.ano_compra }}</q-item-section></q-item>
          </q-list>
          <q-card-actions>
            <q-btn flat no-caps color="primary" icon="auto_awesome" label="Ler edital com IA" :to="{ name: 'oportunidade', params: { id: n.oportunidade_id } }" />
            <q-btn v-if="n.link_pncp" flat no-caps color="primary" icon="open_in_new" label="Edital" :href="n.link_pncp" target="_blank" rel="noopener" />
          </q-card-actions>
        </q-card>

        <q-card flat bordered class="lf-card">
          <q-card-section class="text-h6 q-pb-none">Documentos do negócio</q-card-section>
          <q-list separator>
            <q-item v-for="d in n.documentos" :key="d.id">
              <q-item-section>{{ d.nome }}<q-item-label caption>Validade: {{ data(d.validade) }}</q-item-label></q-item-section>
              <q-item-section side><q-btn flat round dense size="sm" icon="link_off" @click="desvincular(d)" /></q-item-section>
            </q-item>
          </q-list>
          <q-card-section>
            <q-select v-model="docParaVincular" :options="docsDisponiveis" option-value="id" option-label="nome" emit-value map-options
              outlined dense label="Vincular documento" @update:model-value="vincular" />
          </q-card-section>
        </q-card>

        <q-card flat bordered class="lf-card">
          <q-card-actions vertical>
            <q-btn flat no-caps :icon="n.arquivado ? 'unarchive' : 'archive'" :label="n.arquivado ? 'Desarquivar' : 'Arquivar'" @click="salvar({ arquivado: !n.arquivado })" />
            <q-btn flat no-caps color="negative" icon="delete" label="Excluir negócio" @click="excluir" />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useFiltros } from 'stores/filtros';
import { ETAPAS, brl, data, dataHora } from 'src/format';

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const filtros = useFiltros();
const n = ref(null);
const form = reactive({});
const novoItem = ref('');
const docs = ref([]);
const docParaVincular = ref(null);
const docsDisponiveis = computed(() => docs.value.filter((d) => !n.value?.documentos.some((x) => x.id === d.id)));

function preencher(dados) {
  n.value = dados;
  Object.assign(form, {
    titulo: dados.titulo, etapa: dados.etapa, empresa_id: dados.empresa_id, responsavel: dados.responsavel,
    data_disputa: dados.data_disputa?.slice(0, 16) ?? '', valor_proposta: dados.valor_proposta, notas: dados.notas,
  });
}

async function salvar(campos) {
  preencher((await api.patch(`/negocios/${n.value.id}`, campos)).data);
}
async function recarregar() {
  preencher((await api.get(`/negocios/${route.params.id}`)).data);
}
async function marcar(c, feito) {
  c.feito = feito ? 1 : 0;
  await api.patch(`/negocios/${n.value.id}/checklist/${c.id}`, { feito });
}
async function addItem() {
  if (!novoItem.value.trim()) return;
  n.value.checklist.push((await api.post(`/negocios/${n.value.id}/checklist`, { texto: novoItem.value.trim() })).data);
  novoItem.value = '';
}
async function removerItem(c) {
  await api.delete(`/negocios/${n.value.id}/checklist/${c.id}`);
  n.value.checklist = n.value.checklist.filter((x) => x.id !== c.id);
}
async function vincular(docId) {
  if (!docId) return;
  await api.put(`/negocios/${n.value.id}/documentos/${docId}`);
  docParaVincular.value = null;
  recarregar();
}
async function desvincular(d) {
  await api.delete(`/negocios/${n.value.id}/documentos/${d.id}`);
  recarregar();
}
function excluir() {
  $q.dialog({ title: 'Excluir negócio', message: 'Esta ação não pode ser desfeita.', cancel: true, ok: { color: 'negative', label: 'Excluir' } })
    .onOk(async () => {
      await api.delete(`/negocios/${n.value.id}`);
      router.push({ name: 'negocios' });
    });
}

onMounted(async () => {
  await Promise.all([recarregar(), filtros.carregarEmpresas(), api.get('/documentos').then((r) => (docs.value = r.data))]);
});
</script>
