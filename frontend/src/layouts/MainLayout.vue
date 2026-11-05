<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="bg-white text-dark" bordered>
      <q-toolbar>
        <q-btn flat round dense icon="menu" class="lt-md" aria-label="Menu" @click="menu = !menu" />
        <q-toolbar-title class="row items-center no-wrap">
          <img src="/favicon.svg" alt="" width="28" height="28" class="q-mr-sm" />
          <span class="text-weight-bold">Busca Pregão <span class="text-primary">IA</span></span>
        </q-toolbar-title>
        <SinoNotificacoes class="q-mr-sm" />
        <q-btn flat no-caps icon="account_circle" :label="$q.screen.gt.xs ? auth.usuario?.nome : ''">
          <q-menu>
            <q-list style="min-width: 180px">
              <q-item-label header>{{ auth.usuario?.email }}</q-item-label>
              <q-item clickable v-close-popup :to="{ name: 'empresas' }"><q-item-section avatar><q-icon name="business" /></q-item-section><q-item-section>Minhas empresas</q-item-section></q-item>
              <q-item clickable v-close-popup @click="dlgSenha = true"><q-item-section avatar><q-icon name="key" /></q-item-section><q-item-section>Alterar senha</q-item-section></q-item>
              <q-item clickable v-close-popup @click="sair"><q-item-section avatar><q-icon name="logout" /></q-item-section><q-item-section>Sair</q-item-section></q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-dialog v-model="dlgSenha" @hide="senha = { atual: '', nova: '', confirma: '' }">
      <q-card style="width: 380px; max-width: 92vw">
        <q-card-section class="text-h6">Alterar senha</q-card-section>
        <q-form @submit.prevent="trocarSenha">
          <q-card-section class="q-gutter-y-sm q-pt-none">
            <q-input v-model="senha.atual" type="password" label="Senha atual" outlined dense autocomplete="current-password" />
            <q-input v-model="senha.nova" type="password" label="Nova senha (mínimo 8 caracteres)" outlined dense autocomplete="new-password" :rules="[(v) => v.length >= 8 || 'Use pelo menos 8 caracteres']" />
            <q-input v-model="senha.confirma" type="password" label="Repita a nova senha" outlined dense autocomplete="new-password" :rules="[(v) => v === senha.nova || 'As senhas não são iguais']" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="Cancelar" v-close-popup />
            <q-btn unelevated no-caps color="primary" label="Salvar" type="submit" :loading="salvandoSenha" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>

    <q-drawer v-model="menu" show-if-above bordered :width="232" class="bg-white">
      <q-list padding>
        <q-item v-for="i in itens" :key="i.to" :to="{ name: i.to }" :exact="i.to === 'inicio'" clickable v-ripple active-class="text-primary bg-blue-1">
          <q-item-section avatar><q-icon :name="i.icone" /></q-item-section>
          <q-item-section>{{ i.nome }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Notify } from 'quasar';
import { api } from 'boot/axios';
import { useAuth } from 'stores/auth';
import SinoNotificacoes from 'components/SinoNotificacoes.vue';

const auth = useAuth();
const router = useRouter();
const menu = ref(false);
const dlgSenha = ref(false);
const salvandoSenha = ref(false);
const senha = ref({ atual: '', nova: '', confirma: '' });
async function trocarSenha() {
  if (senha.value.nova.length < 8 || senha.value.nova !== senha.value.confirma) return;
  salvandoSenha.value = true;
  try {
    await api.put('/auth/senha', { atual: senha.value.atual, nova: senha.value.nova });
    dlgSenha.value = false;
    Notify.create({ type: 'positive', message: 'Senha alterada.' });
  } finally {
    salvandoSenha.value = false;
  }
}
const itens = [
  { to: 'inicio', nome: 'Início', icone: 'space_dashboard' },
  { to: 'agentes', nome: 'Agentes', icone: 'smart_toy' },
  { to: 'chat', nome: 'Busca no Chat', icone: 'forum' },
  { to: 'oportunidades', nome: 'Oportunidades', icone: 'travel_explore' },
  { to: 'negocios', nome: 'Meus negócios', icone: 'view_kanban' },
  { to: 'juridico', nome: 'Peças jurídicas', icone: 'balance' },
  { to: 'agenda', nome: 'Agenda', icone: 'event' },
  { to: 'documentos', nome: 'Documentos', icone: 'folder_shared' },
  { to: 'alertas', nome: 'Alertas', icone: 'notifications_active' },
  { to: 'mercado', nome: 'Análise de mercado', icone: 'insights' },
  { to: 'analise-empresas', nome: 'Análise de empresas', icone: 'domain' },
  { to: 'historico', nome: 'Histórico de compras', icone: 'query_stats' },
  { to: 'pagometro', nome: 'Pagômetro', icone: 'speed' },
  { to: 'empresas', nome: 'Empresas', icone: 'business' },
];

async function sair() {
  await auth.sair();
  router.push({ name: 'login' });
}
</script>
