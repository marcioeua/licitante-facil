<template>
  <q-card flat bordered class="lf-card q-mb-md">
    <q-card-section class="row items-start q-col-gutter-md">
      <div class="col-12 col-md-5 row items-start no-wrap">
        <q-avatar color="light-blue-7" text-color="white" icon="send" size="44px" class="q-mr-md" />
        <div>
          <div class="text-subtitle1 text-weight-bold">Avisos no Telegram</div>
          <div class="text-body2 text-grey-7">Grátis e sem chip: receba os avisos dos agentes e o <b>edital em PDF</b> de cada licitação nova no Telegram.</div>
          <q-badge v-if="estado?.ativo" color="positive" label="Ativo" class="q-mt-xs" />
          <q-badge v-else-if="estado?.conectado" color="grey-6" label="Pausado" class="q-mt-xs" />
          <q-badge v-else color="grey-6" label="Não conectado" class="q-mt-xs" />
        </div>
      </div>
      <div class="col-12 col-md-7">
        <q-skeleton v-if="!estado" height="70px" />
        <q-banner v-else-if="!estado.servidor" dense rounded class="bg-amber-1 text-amber-10">
          <template #avatar><q-icon name="info" /></template>
          O robô do Telegram ainda não foi configurado no servidor (falta TELEGRAM_BOT_TOKEN no Railway).
        </q-banner>
        <template v-else-if="!estado.conectado">
          <ol class="q-my-none q-pl-md text-body2">
            <li>Clique em <b>Conectar Telegram</b>: abre o robô no Telegram.</li>
            <li>No Telegram, toque em <b>Começar</b> (ou <b>Iniciar</b>).</li>
            <li>Volte aqui e clique em <b>Já toquei em Começar</b>.</li>
          </ol>
          <div class="row q-gutter-sm q-mt-sm">
            <q-btn unelevated no-caps color="light-blue-7" icon="send" label="Conectar Telegram" :loading="conectando" @click="conectar" />
            <q-btn v-if="link" outline no-caps color="primary" icon="check" label="Já toquei em Começar" :loading="verificando" @click="verificar" />
          </div>
          <div v-if="link" class="text-caption text-grey-7 q-mt-xs">Não abriu? <a :href="link" target="_blank" rel="noopener">Clique aqui</a> ou abra no celular.</div>
        </template>
        <template v-else>
          <q-toggle :model-value="estado.ativo" label="Receber avisos pelo Telegram" @update:model-value="ativar" />
          <div class="row q-gutter-sm q-mt-sm">
            <q-btn outline no-caps color="positive" icon="send" label="Enviar mensagem de teste" :loading="testando" @click="testar" />
            <q-btn flat no-caps color="grey-8" icon="link" label="Conectar outro Telegram" @click="estado.conectado = false" />
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
const link = ref('');
const conectando = ref(false);
const verificando = ref(false);
const testando = ref(false);

function aplicar(e) {
  estado.value = e;
  emit('mudou', e);
}
async function conectar() {
  conectando.value = true;
  try {
    link.value = (await api.post('/telegram/conectar', {})).data.link;
    window.open(link.value, '_blank', 'noopener');
  } finally {
    conectando.value = false;
  }
}
async function verificar() {
  verificando.value = true;
  try {
    aplicar((await api.post('/telegram/verificar', {})).data);
    Notify.create(estado.value.conectado
      ? { type: 'positive', message: 'Telegram conectado! Confira a mensagem do robô.' }
      : { type: 'warning', message: 'Ainda não recebemos o "Começar". Toque em Começar no robô e tente de novo.' });
  } finally {
    verificando.value = false;
  }
}
async function ativar(v) {
  aplicar((await api.put('/telegram', { ativo: v })).data);
}
async function testar() {
  testando.value = true;
  try {
    await api.post('/telegram/teste', {});
    Notify.create({ type: 'positive', message: 'Mensagem enviada. Confira seu Telegram.' });
  } finally {
    testando.value = false;
  }
}
onMounted(async () => aplicar((await api.get('/telegram')).data));
</script>
