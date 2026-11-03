<template>
  <q-page padding>
    <div class="row items-center q-mb-md q-gutter-sm">
      <div class="text-h5 text-weight-bold col">Alertas</div>
      <q-btn unelevated no-caps color="primary" icon="add" label="Novo alerta" @click="abrir()" />
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Cada alerta procura licitações novas com as palavras que você escolher e envia um resumo por e-mail todos os dias.
    </div>

    <div v-if="!alertas.length" class="text-center text-grey-7 q-pa-xl">
      <q-icon name="notifications_none" size="48px" /><br />Você ainda não tem alertas.
    </div>
    <div class="row q-col-gutter-md">
      <div v-for="a in alertas" :key="a.id" class="col-12 col-md-6">
        <q-card flat bordered class="lf-card">
          <q-card-section>
            <div class="row items-center">
              <div class="text-h6 col">{{ a.nome }}</div>
              <q-toggle :model-value="a.email_ativo" icon="mail" @update:model-value="(v) => salvar({ ...a, email_ativo: v })" />
            </div>
            <div class="q-gutter-xs q-mt-xs">
              <q-chip v-for="p in a.palavras.split(',')" :key="p" dense color="blue-1" text-color="primary">{{ p.trim() }}</q-chip>
            </div>
            <div class="text-caption text-grey-7 q-mt-xs">
              {{ a.municipios?.length ? a.municipios.map((m) => m.split(':').reverse().join('/')).join(', ') : a.ufs.length ? a.ufs.join(', ') : 'Todo o Brasil' }} ·
              {{ a.modalidades.length ? `${a.modalidades.length} modalidade(s)` : 'Todas as modalidades' }}
              <span v-if="a.valor_min || a.valor_max"> · {{ brl(a.valor_min ?? 0) }} a {{ a.valor_max ? brl(a.valor_max) : 'sem limite' }}</span>
            </div>
          </q-card-section>
          <q-card-actions>
            <q-btn flat no-caps color="primary" icon="travel_explore" label="Ver resultados"
              :to="{ name: 'oportunidades', query: { q: a.palavras.split(',')[0].trim(), uf: a.ufs.join(',') || undefined, municipio: a.municipios?.join(',') || undefined } }" />
            <q-space />
            <q-btn flat round icon="edit" @click="abrir(a)" />
            <q-btn flat round icon="delete" color="negative" @click="remover(a)" />
          </q-card-actions>
        </q-card>
      </div>
    </div>

    <q-dialog v-model="dialogo">
      <q-card style="width: 520px; max-width: 95vw">
        <q-card-section class="text-h6">{{ form.id ? 'Editar alerta' : 'Novo alerta' }}</q-card-section>
        <q-form @submit="salvar(form, true)">
          <q-card-section class="q-gutter-md">
            <q-input v-model="form.nome" outlined label="Nome do alerta" :rules="[(v) => !!v || 'Obrigatório']" />
            <q-input v-model="form.palavras" outlined label="Palavras-chave" hint="Separe por vírgula. Ex.: notebook, computador, impressora"
              :rules="[(v) => v?.length >= 2 || 'Informe ao menos uma palavra']" />
            <q-select v-model="form.ufs" :options="filtros.ufs" multiple use-chips outlined label="Estados (vazio = todos)" />
            <CidadesSelect v-model="form.municipios" :ufs="form.ufs" label="Cidades (vazio = todas)" />
            <q-select v-model="form.modalidades" :options="filtros.modalidades" option-value="id" option-label="nome" emit-value map-options
              multiple use-chips outlined label="Modalidades (vazio = todas)" />
            <div class="row q-col-gutter-sm">
              <div class="col"><q-input v-model.number="form.valor_min" type="number" outlined label="Valor mínimo (R$)" /></div>
              <div class="col"><q-input v-model.number="form.valor_max" type="number" outlined label="Valor máximo (R$)" /></div>
            </div>
            <q-toggle v-model="form.email_ativo" label="Receber por e-mail" />
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
import { brl } from 'src/format';
import CidadesSelect from 'components/CidadesSelect.vue';

const $q = useQuasar();
const filtros = useFiltros();
const alertas = ref([]);
const dialogo = ref(false);
const form = reactive({});

async function carregar() {
  alertas.value = (await api.get('/alertas')).data;
}
function abrir(a) {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, a
    ? { ...a, ufs: [...a.ufs], modalidades: [...a.modalidades], municipios: [...(a.municipios ?? [])] }
    : { nome: '', palavras: '', ufs: [], municipios: [], modalidades: [], valor_min: null, valor_max: null, email_ativo: true });
  dialogo.value = true;
}
async function salvar(a, fechar = false) {
  const body = {
    nome: a.nome, palavras: a.palavras, ufs: a.ufs, municipios: a.municipios ?? [], modalidades: a.modalidades,
    valor_min: a.valor_min === '' ? null : a.valor_min ?? null, valor_max: a.valor_max === '' ? null : a.valor_max ?? null,
    email_ativo: a.email_ativo,
  };
  if (a.id) await api.put(`/alertas/${a.id}`, body);
  else await api.post('/alertas', body);
  if (fechar) dialogo.value = false;
  carregar();
}
function remover(a) {
  $q.dialog({ title: 'Excluir alerta', message: `Excluir "${a.nome}"?`, cancel: true, ok: { color: 'negative', label: 'Excluir' } })
    .onOk(async () => {
      await api.delete(`/alertas/${a.id}`);
      carregar();
    });
}
onMounted(() => Promise.all([carregar(), filtros.carregar()]));
</script>
