<template>
  <q-page padding>
    <div class="row items-center q-mb-md q-gutter-sm">
      <div class="text-h5 text-weight-bold col">Agenda</div>
      <q-btn unelevated no-caps color="primary" icon="add" label="Novo compromisso" @click="dialogo = true" />
    </div>
    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-auto">
        <q-date v-model="dia" :events="diasComEventos" event-color="primary" minimal flat bordered class="lf-card" mask="YYYY-MM-DD"
          @navigation="(v) => mudarMes(v)" />
      </div>
      <div class="col">
        <div v-if="!itens.length" class="text-grey-7 q-pa-md">Nada agendado neste período.</div>
        <div v-for="(grupo, d) in porDia" :key="d" class="q-mb-md" :id="'dia-' + d">
          <div class="text-subtitle2 text-grey-8 q-mb-xs" :class="{ 'text-primary': d === dia }">{{ tituloDia(d) }}</div>
          <q-list bordered separator class="lf-card bg-white">
            <q-item v-for="(e, i) in grupo" :key="i" :clickable="!!(e.negocio_id || e.documento_id)" @click="abrir(e)">
              <q-item-section avatar><q-icon :name="tipos[e.tipo].icone" :color="tipos[e.tipo].cor" /></q-item-section>
              <q-item-section>
                <q-item-label>{{ e.titulo }}</q-item-label>
                <q-item-label caption>{{ tipos[e.tipo].nome }}<span v-if="e.inicio.length > 10"> · {{ e.inicio.slice(11, 16) }}</span><span v-if="e.orgao_nome"> · {{ e.orgao_nome }}</span></q-item-label>
              </q-item-section>
              <q-item-section v-if="e.tipo === 'evento'" side><q-btn flat round dense icon="delete" size="sm" @click.stop="remover(e)" /></q-item-section>
            </q-item>
          </q-list>
        </div>
      </div>
    </div>

    <q-dialog v-model="dialogo">
      <q-card style="width: 420px; max-width: 95vw">
        <q-card-section class="text-h6">Novo compromisso</q-card-section>
        <q-form @submit="criar">
          <q-card-section class="q-gutter-md">
            <q-input v-model="novo.titulo" outlined label="Título" :rules="[(v) => !!v || 'Obrigatório']" />
            <q-input v-model="novo.inicio" outlined type="datetime-local" label="Data e hora" stack-label :rules="[(v) => !!v || 'Obrigatório']" />
            <q-input v-model="novo.descricao" outlined type="textarea" autogrow label="Descrição" />
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from 'boot/axios';

const router = useRouter();
const hoje = new Date().toISOString().slice(0, 10);
const dia = ref(hoje);
const itens = ref([]);
const dialogo = ref(false);
const novo = reactive({ titulo: '', inicio: '', descricao: '' });
const periodo = reactive({ de: hoje, ate: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10) });
const tipos = {
  disputa: { nome: 'Disputa', icone: 'gavel', cor: 'orange-8' },
  vencimento: { nome: 'Vencimento de documento', icone: 'event_busy', cor: 'negative' },
  evento: { nome: 'Compromisso', icone: 'event', cor: 'primary' },
};

const porDia = computed(() => itens.value.reduce((acc, e) => ((acc[e.inicio.slice(0, 10)] ??= []).push(e), acc), {}));
const diasComEventos = computed(() => Object.keys(porDia.value).map((d) => d.replaceAll('-', '/')));
const tituloDia = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

async function carregar() {
  itens.value = (await api.get('/agenda', { params: periodo })).data;
}
function mudarMes({ year, month }) {
  const ini = new Date(year, month - 1, 1);
  periodo.de = ini.toISOString().slice(0, 10);
  periodo.ate = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  carregar();
}
function abrir(e) {
  if (e.negocio_id) router.push({ name: 'negocio', params: { id: e.negocio_id } });
  else if (e.documento_id) router.push({ name: 'documentos' });
}
async function criar() {
  await api.post('/agenda/eventos', { ...novo, descricao: novo.descricao || null });
  Object.assign(novo, { titulo: '', inicio: '', descricao: '' });
  dialogo.value = false;
  carregar();
}
async function remover(e) {
  await api.delete(`/agenda/eventos/${e.evento_id}`);
  carregar();
}
onMounted(carregar);
</script>
