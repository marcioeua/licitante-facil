<template>
  <q-btn flat round dense icon="notifications" aria-label="Avisos dos agentes">
    <q-badge v-if="naoLidas" color="negative" floating rounded>{{ naoLidas > 99 ? '99+' : naoLidas }}</q-badge>
    <q-menu anchor="bottom right" self="top right" @show="carregar">
      <q-card style="width: 380px; max-width: 92vw">
        <q-card-section class="row items-center q-py-sm">
          <div class="col text-subtitle1 text-weight-medium">Avisos dos agentes</div>
          <q-btn v-if="naoLidas" flat dense no-caps size="sm" color="primary" label="Marcar todas como lidas" @click="lerTodas" />
        </q-card-section>
        <q-separator />
        <q-list separator style="max-height: 420px; overflow-y: auto">
          <q-item v-for="n in itens" :key="n.id" clickable v-close-popup :class="{ 'bg-blue-1': !n.lida }" @click="abrir(n)">
            <q-item-section avatar><q-icon :name="ICONES[n.tipo] ?? 'smart_toy'" :color="n.tipo === 'mudanca_grave' ? 'negative' : 'primary'" /></q-item-section>
            <q-item-section>
              <q-item-label lines="2" class="text-weight-medium">{{ n.titulo }}</q-item-label>
              <q-item-label v-if="n.mensagem" caption lines="3" style="white-space: pre-line">{{ n.mensagem }}</q-item-label>
              <q-item-label caption>{{ quando(n.criado_em) }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="!itens.length"><q-item-section class="text-grey-7">Nenhum aviso ainda. Ative os agentes na página Agentes.</q-item-section></q-item>
        </q-list>
        <q-separator />
        <q-card-actions align="center"><q-btn flat no-caps color="primary" label="Configurar agentes" :to="{ name: 'agentes' }" v-close-popup /></q-card-actions>
      </q-card>
    </q-menu>
  </q-btn>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from 'boot/axios';

const router = useRouter();
const naoLidas = ref(0);
const itens = ref([]);
let timer = null;
const ICONES = { prospeccao: 'travel_explore', mudanca: 'update', mudanca_grave: 'warning', documento: 'description', lembrete: 'alarm', edital_lido: 'auto_awesome', prazo_pregoeiro: 'campaign' };

function quando(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
async function carregar() {
  try {
    const { data } = await api.get('/notificacoes', { silencioso: true });
    naoLidas.value = data.naoLidas;
    itens.value = data.itens;
  } catch { /* sem login ou offline */ }
}
async function abrir(n) {
  if (!n.lida) {
    await api.post('/notificacoes/lidas', { ids: [n.id] });
    n.lida = 1;
    naoLidas.value = Math.max(0, naoLidas.value - 1);
  }
  // Edital lido: abre o resumo do edital (página da licitação); avisos antigos apontavam para o negócio.
  if (n.tipo === 'edital_lido' && n.oportunidade_id) router.push({ name: 'oportunidade', params: { id: n.oportunidade_id }, query: { ver: 'edital' } });
  else if (n.link) router.push(n.link);
}
async function lerTodas() {
  await api.post('/notificacoes/lidas', { todas: true });
  itens.value.forEach((n) => (n.lida = 1));
  naoLidas.value = 0;
}
onMounted(() => {
  carregar();
  timer = setInterval(carregar, 60000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>
