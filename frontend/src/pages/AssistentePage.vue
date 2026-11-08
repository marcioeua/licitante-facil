<template>
  <q-page class="assist row no-wrap">
    <!-- Conversas -->
    <div v-if="$q.screen.gt.sm || mostrarLista" class="assist-lista column">
      <div class="q-pa-md">
        <q-btn unelevated no-caps color="primary" icon="add" label="Nova conversa" class="full-width" @click="nova" />
      </div>
      <q-list class="col scroll">
        <q-item v-for="c in conversas" :key="c.id" clickable :active="c.id === conversaId" active-class="bg-blue-1 text-primary" @click="abrir(c.id)">
          <q-item-section><q-item-label lines="2" class="text-body2">{{ c.titulo }}</q-item-label><q-item-label caption>{{ quando(c.atualizado_em) }}</q-item-label></q-item-section>
          <q-item-section side><q-btn flat round dense size="sm" icon="delete_outline" @click.stop="apagar(c)" /></q-item-section>
        </q-item>
        <q-item v-if="!conversas.length"><q-item-section class="text-grey-6 text-body2">Suas conversas aparecem aqui.</q-item-section></q-item>
      </q-list>
    </div>

    <!-- Chat -->
    <div class="col column no-wrap assist-chat">
      <div class="row items-center q-px-md q-py-sm assist-topo">
        <q-btn v-if="!$q.screen.gt.sm" flat round dense icon="forum" class="q-mr-sm" @click="mostrarLista = !mostrarLista" />
        <q-icon name="auto_awesome" color="primary" size="22px" class="q-mr-sm" />
        <div class="text-subtitle1 text-weight-bold col ellipsis">{{ titulo || 'Assistente IA' }}</div>
        <q-btn v-if="suporteFala" flat round dense :icon="lerRespostas ? 'volume_up' : 'volume_off'" :color="lerRespostas ? 'primary' : 'grey-7'" @click="alternarLeitura">
          <q-tooltip>{{ lerRespostas ? 'Desligar a leitura das respostas em voz alta' : 'Ouvir as respostas em voz alta' }}</q-tooltip>
        </q-btn>
      </div>

      <div ref="rolagem" class="col scroll q-px-md q-py-md">
        <div v-if="!mensagens.length && !enviando" class="assist-vazio">
          <q-icon name="auto_awesome" color="primary" size="48px" />
          <div class="text-h6 text-weight-bold q-mt-sm">Pergunte sobre licitações</div>
          <div class="text-body2 text-grey-7 q-mb-md">O assistente busca licitações abertas no PNCP, lê editais, confere sua documentação e consulta seus negócios.</div>
          <div class="row q-gutter-sm justify-center">
            <q-btn v-for="s in SUGESTOES" :key="s" outline no-caps color="primary" class="sugestao" :label="s" @click="enviar(s)" />
          </div>
          <div v-if="!iaDisponivel" class="text-negative text-body2 q-mt-md">A IA não está ligada no servidor (falta a chave da IA).</div>
        </div>

        <div v-for="m in mensagens" :key="m.id" class="q-mb-md row" :class="m.papel === 'user' ? 'justify-end' : 'justify-start'">
          <div v-if="m.papel === 'user'" class="balao-user">{{ m.texto }}</div>
          <div v-else class="balao-ia">
            <div v-if="m.ferramentas?.length" class="q-mb-xs">
              <q-chip v-for="(f, k) in m.ferramentas" :key="k" dense size="sm" icon="bolt" color="blue-1" text-color="blue-10">{{ f }}</q-chip>
            </div>
            <div v-if="m.texto" class="texto-md" v-html="markdownParaHtml(m.texto)" />
          </div>
        </div>
        <div v-if="enviando" class="row items-center q-gutter-sm text-grey-7 q-mb-md">
          <q-spinner-dots color="primary" size="26px" />
          <span>Pensando e consultando os dados… se precisar ler um edital, pode levar 1 a 2 minutos.</span>
        </div>
      </div>

      <div class="q-pa-md assist-entrada">
        <q-input v-model="texto" outlined autogrow :input-style="{ maxHeight: '160px' }"
          :placeholder="ouvindo ? 'Pode falar… estou ouvindo' : 'Digite ou toque no microfone para falar'"
          :disable="enviando || !iaDisponivel" @keydown.enter.exact.prevent="enviar()">
          <template #append>
            <q-btn v-if="suporteVoz" round flat :color="ouvindo ? 'negative' : 'grey-8'" :icon="ouvindo ? 'stop_circle' : 'mic'" :class="{ pulsando: ouvindo }"
              :disable="enviando || !iaDisponivel" @click="alternarVoz">
              <q-tooltip>{{ ouvindo ? 'Parar' : 'Falar a pergunta' }}</q-tooltip>
            </q-btn>
            <q-btn round flat color="primary" icon="send" :disable="!texto.trim() || enviando" @click="enviar()" />
          </template>
        </q-input>
        <div class="text-caption text-grey-6 q-mt-xs">A IA pode errar: confira prazos e exigências no edital. Cada mensagem tem um pequeno custo (veja em Uso da IA).</div>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar, Notify } from 'quasar';
import { api } from 'boot/axios';
import { markdownParaHtml } from 'components/markdown.js';

const SUGESTOES = [
  'Pregões abertos de material de limpeza em MG até 100 mil',
  'Licitações de até 50 mil que não exijam atestado de capacidade técnica',
  'Quais são os meus negócios com disputa nesta semana?',
  'Estou apto a participar dos meus negócios em triagem?',
];

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const conversas = ref([]);
const conversaId = ref(null);
const titulo = ref('');
const mensagens = ref([]);
const texto = ref('');
const enviando = ref(false);
const iaDisponivel = ref(true);
const mostrarLista = ref(false);
const rolagem = ref(null);

// ---- Voz: reconhecimento de fala e leitura das respostas (recursos do próprio navegador, grátis) ----
const Reconhecimento = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const suporteVoz = !!Reconhecimento;
const suporteFala = typeof window !== 'undefined' && 'speechSynthesis' in window;
const ouvindo = ref(false);
let rec = null;
const lerLocal = () => { try { return localStorage.getItem('assistente_ler') === '1'; } catch { return false; } };
const lerRespostas = ref(lerLocal());
function alternarLeitura() {
  lerRespostas.value = !lerRespostas.value;
  try { localStorage.setItem('assistente_ler', lerRespostas.value ? '1' : '0'); } catch { /* sem armazenamento */ }
  if (!lerRespostas.value) window.speechSynthesis.cancel();
}
function alternarVoz() {
  if (ouvindo.value) { rec?.stop(); return; }
  if (suporteFala) window.speechSynthesis.cancel();
  rec = new Reconhecimento();
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  let final = '';
  rec.onresult = (ev) => {
    let parcial = '';
    for (const r of ev.results) {
      if (r.isFinal) final = r[0].transcript; else parcial += r[0].transcript;
    }
    texto.value = (final || parcial).trim();
  };
  rec.onerror = (ev) => {
    const msg = { 'not-allowed': 'Permita o uso do microfone no navegador para falar a pergunta.', 'service-not-allowed': 'Permita o uso do microfone no navegador para falar a pergunta.',
      'no-speech': 'Não ouvi nada. Toque no microfone e fale de novo.', 'audio-capture': 'Nenhum microfone encontrado.', network: 'Sem conexão para reconhecer a voz.' }[ev.error];
    if (msg) Notify.create({ type: 'warning', message: msg });
  };
  rec.onend = () => {
    ouvindo.value = false;
    // Falou e terminou: envia sozinho.
    if (final.trim()) enviar(final.trim());
  };
  ouvindo.value = true;
  rec.start();
}
function falar(md) {
  if (!suporteFala || !lerRespostas.value || !md) return;
  const txt = md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[*#|`_>]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  const u = new SpeechSynthesisUtterance(txt.slice(0, 1500));
  u.lang = 'pt-BR';
  const voz = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt'));
  if (voz) u.voice = voz;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
onBeforeUnmount(() => { rec?.abort?.(); if (suporteFala) window.speechSynthesis.cancel(); });

const quando = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const descer = () => nextTick(() => { if (rolagem.value) rolagem.value.scrollTop = rolagem.value.scrollHeight; });

async function listar() {
  const r = (await api.get('/assistente/conversas')).data;
  conversas.value = r.conversas;
  iaDisponivel.value = r.iaDisponivel;
}
async function abrir(id) {
  mostrarLista.value = false;
  const r = (await api.get(`/assistente/conversas/${id}`)).data;
  conversaId.value = r.id;
  titulo.value = r.titulo;
  mensagens.value = r.mensagens;
  router.replace({ query: { c: r.id } });
  descer();
}
function nova() {
  conversaId.value = null;
  titulo.value = '';
  mensagens.value = [];
  mostrarLista.value = false;
  router.replace({ query: {} });
}
async function enviar(t) {
  const msg = String(t ?? texto.value).trim();
  if (!msg || enviando.value) return;
  texto.value = '';
  mensagens.value.push({ id: `tmp${Date.now()}`, papel: 'user', texto: msg });
  enviando.value = true;
  descer();
  try {
    const r = (await api.post('/assistente/mensagens', { conversaId: conversaId.value, mensagem: msg }, { timeout: 600000 })).data;
    mensagens.value.pop();
    mensagens.value.push(...r.mensagens);
    falar(r.mensagens.filter((m) => m.papel === 'assistant' && m.texto).at(-1)?.texto);
    if (!conversaId.value) {
      conversaId.value = r.conversaId;
      titulo.value = r.titulo;
      router.replace({ query: { c: r.conversaId } });
      listar();
    }
  } catch {
    mensagens.value.pop();
    texto.value = msg;
  } finally {
    enviando.value = false;
    descer();
  }
}
function apagar(c) {
  $q.dialog({ title: 'Apagar conversa?', message: c.titulo, cancel: { flat: true, label: 'Cancelar' }, ok: { label: 'Apagar', color: 'negative', unelevated: true } })
    .onOk(async () => {
      await api.delete(`/assistente/conversas/${c.id}`);
      if (c.id === conversaId.value) nova();
      listar();
    });
}
onMounted(async () => {
  await listar();
  if (route.query.c) abrir(Number(route.query.c));
  else if (route.query.q) enviar(String(route.query.q));
});
</script>

<style scoped>
.assist { height: calc(100vh - 51px); position: relative; }
.assist-lista { width: 280px; border-right: 1px solid #e5e7eb; background: #fff; }
.assist-chat { background: #f7f8fa; min-width: 0; }
.assist-topo, .assist-entrada { background: #fff; border-bottom: 1px solid #e5e7eb; }
.assist-entrada { border-top: 1px solid #e5e7eb; border-bottom: none; }
.assist-vazio { max-width: 640px; margin: 40px auto; text-align: center; }
.sugestao { max-width: 300px; }
.pulsando { animation: pulsar 1.2s ease-in-out infinite; }
@keyframes pulsar { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }
.balao-user { max-width: 75%; background: #1d4ed8; color: #fff; padding: 10px 14px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; }
.balao-ia { max-width: 85%; background: #fff; border: 1px solid #e5e7eb; padding: 10px 14px; border-radius: 16px 16px 16px 4px; }
.texto-md :deep(p) { margin: 0 0 8px; }
.texto-md :deep(p:last-child) { margin-bottom: 0; }
.texto-md :deep(ul), .texto-md :deep(ol) { margin: 4px 0 8px; padding-left: 20px; }
.texto-md :deep(h3), .texto-md :deep(h4) { font-size: 15px; margin: 8px 0 4px; font-weight: 700; line-height: 1.3; }
.texto-md :deep(table) { border-collapse: collapse; font-size: 13px; margin: 6px 0; }
.texto-md :deep(th), .texto-md :deep(td) { border: 1px solid #ddd; padding: 3px 6px; }
@media (max-width: 1023px) {
  .assist-lista { position: absolute; z-index: 10; height: 100%; box-shadow: 0 4px 16px rgba(0,0,0,.15); }
}
</style>
