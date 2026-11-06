<template>
  <q-card flat bordered class="lf-card q-mb-md">
    <q-card-section class="row items-start q-col-gutter-md">
      <div class="col-12 col-md-5 row items-start no-wrap">
        <q-avatar color="green-7" text-color="white" icon="chat" size="44px" class="q-mr-md" />
        <div>
          <div class="text-subtitle1 text-weight-bold">Avisos no WhatsApp</div>
          <div class="text-body2 text-grey-7">Receba no seu celular os avisos dos agentes e o <b>edital em PDF</b> de cada licitação nova. Pela API oficial do WhatsApp (Meta).</div>
          <q-badge v-if="estado?.ativo" color="positive" label="Ativo" class="q-mt-xs" />
          <q-badge v-else color="grey-6" label="Desligado" class="q-mt-xs" />
        </div>
      </div>
      <div class="col-12 col-md-7">
        <q-skeleton v-if="!estado" height="80px" />
        <template v-else>
          <q-banner v-if="!estado.servidor" dense rounded class="bg-amber-1 text-amber-10 q-mb-sm">
            <template #avatar><q-icon name="info" /></template>
            O WhatsApp ainda não foi conectado no servidor (falta a conta da Meta). Você já pode salvar o número; os avisos começam quando a conexão for feita.
          </q-banner>
          <div class="row q-col-gutter-sm items-start">
            <div class="col-12 col-sm-6"><q-input v-model="numero" outlined dense label="Seu WhatsApp (DDD + número)" placeholder="(11) 98765-4321" /></div>
            <div class="col-12 col-sm-6"><q-toggle v-model="ativo" label="Receber avisos pelo WhatsApp" /></div>
          </div>
          <q-checkbox v-model="consentimento" dense class="q-mt-xs text-body2" label="Autorizo o Busca Pregão IA a me enviar avisos de licitações pelo WhatsApp. Posso desligar quando quiser." />
          <div class="row q-gutter-sm q-mt-sm">
            <q-btn unelevated no-caps color="primary" label="Salvar" :loading="salvando" @click="salvar" />
            <q-btn outline no-caps color="positive" icon="send" label="Enviar mensagem de teste" :disable="!estado.servidor || !estado.numero" :loading="testando" @click="testar" />
          </div>
        </template>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Notify } from 'quasar';
import { api } from 'boot/axios';

const emit = defineEmits(['mudou']);
const estado = ref(null);
const numero = ref('');
const ativo = ref(false);
const consentimento = ref(false);
const salvando = ref(false);
const testando = ref(false);
const formatar = (n) => (n?.startsWith('55') ? n.slice(2).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : n ?? '');

function aplicar(e) {
  estado.value = e;
  numero.value = formatar(e.numero);
  ativo.value = e.ativo;
  consentimento.value = e.ativo;
  emit('mudou', e);
}
async function salvar() {
  salvando.value = true;
  try {
    aplicar((await api.put('/whatsapp', { numero: numero.value || null, ativo: ativo.value, consentimento: consentimento.value })).data);
    Notify.create({ type: 'positive', message: ativo.value ? 'WhatsApp ativado.' : 'Configuração salva.' });
  } finally {
    salvando.value = false;
  }
}
async function testar() {
  testando.value = true;
  try {
    await api.post('/whatsapp/teste');
    Notify.create({ type: 'positive', message: 'Mensagem enviada. Confira seu WhatsApp.' });
  } finally {
    testando.value = false;
  }
}
onMounted(async () => aplicar((await api.get('/whatsapp')).data));
</script>
