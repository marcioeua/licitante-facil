<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="bg-white text-dark" bordered>
      <q-toolbar>
        <q-btn flat round dense icon="menu" class="lt-md" aria-label="Menu" @click="menu = !menu" />
        <q-toolbar-title class="row items-center no-wrap">
          <img src="/favicon.svg" alt="" width="28" height="28" class="q-mr-sm" />
          <span class="text-weight-bold">Facilita <span class="text-primary">Pregão</span></span>
        </q-toolbar-title>
        <q-btn flat no-caps icon="account_circle" :label="$q.screen.gt.xs ? auth.usuario?.nome : ''">
          <q-menu>
            <q-list style="min-width: 180px">
              <q-item-label header>{{ auth.usuario?.email }}</q-item-label>
              <q-item clickable v-close-popup :to="{ name: 'empresas' }"><q-item-section avatar><q-icon name="business" /></q-item-section><q-item-section>Minhas empresas</q-item-section></q-item>
              <q-item clickable v-close-popup @click="sair"><q-item-section avatar><q-icon name="logout" /></q-item-section><q-item-section>Sair</q-item-section></q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

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
import { useAuth } from 'stores/auth';

const auth = useAuth();
const router = useRouter();
const menu = ref(false);
const itens = [
  { to: 'inicio', nome: 'Início', icone: 'space_dashboard' },
  { to: 'oportunidades', nome: 'Oportunidades', icone: 'travel_explore' },
  { to: 'negocios', nome: 'Meus negócios', icone: 'view_kanban' },
  { to: 'agenda', nome: 'Agenda', icone: 'event' },
  { to: 'documentos', nome: 'Documentos', icone: 'folder_shared' },
  { to: 'alertas', nome: 'Alertas', icone: 'notifications_active' },
  { to: 'historico', nome: 'Histórico de compras', icone: 'query_stats' },
  { to: 'pagometro', nome: 'Pagômetro', icone: 'speed' },
  { to: 'empresas', nome: 'Empresas', icone: 'business' },
];

async function sair() {
  await auth.sair();
  router.push({ name: 'login' });
}
</script>
