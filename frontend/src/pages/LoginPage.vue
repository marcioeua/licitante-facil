<template>
  <q-layout>
    <q-page-container>
      <q-page class="flex flex-center q-pa-md" style="background: linear-gradient(135deg, #1d4ed8 0%, #0f766e 100%)">
        <q-card class="lf-card" style="width: 100%; max-width: 400px">
          <q-card-section class="text-center q-pt-lg">
            <img src="/favicon.svg" alt="" width="48" height="48" />
            <div class="text-h5 text-weight-bold q-mt-sm">Facilita <span class="text-primary">Pregão</span></div>
            <div class="text-grey-7">Encontre licitações e organize suas propostas</div>
          </q-card-section>
          <q-tabs v-model="aba" dense class="text-grey-8" active-color="primary" indicator-color="primary" no-caps>
            <q-tab name="entrar" label="Entrar" />
            <q-tab name="cadastro" label="Criar conta" />
          </q-tabs>
          <q-form class="q-pa-lg q-gutter-md" @submit="enviar">
            <q-input v-if="aba === 'cadastro'" v-model="nome" label="Seu nome" outlined autocomplete="name" :rules="[(v) => v?.length >= 2 || 'Informe seu nome']" />
            <q-input v-model="email" label="E-mail" type="email" outlined autocomplete="email" :rules="[(v) => /.+@.+\..+/.test(v) || 'E-mail inválido']" />
            <q-input v-model="senha" label="Senha" :type="ver ? 'text' : 'password'" outlined
              :autocomplete="aba === 'cadastro' ? 'new-password' : 'current-password'"
              :rules="[(v) => aba === 'entrar' || v?.length >= 8 || 'Mínimo de 8 caracteres']">
              <template #append><q-icon :name="ver ? 'visibility_off' : 'visibility'" class="cursor-pointer" @click="ver = !ver" /></template>
            </q-input>
            <q-input v-if="aba === 'cadastro'" v-model="convite" label="Código de convite (se recebeu um)" outlined autocomplete="off" />
            <q-btn type="submit" color="primary" unelevated no-caps size="lg" class="full-width" :loading="enviando"
              :label="aba === 'entrar' ? 'Entrar' : 'Criar conta grátis'" />
          </q-form>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from 'stores/auth';

const auth = useAuth();
const route = useRoute();
const router = useRouter();
const aba = ref('entrar');
const nome = ref('');
const email = ref('');
const senha = ref('');
const convite = ref('');
const ver = ref(false);
const enviando = ref(false);

async function enviar() {
  enviando.value = true;
  try {
    if (aba.value === 'entrar') await auth.login(email.value, senha.value);
    else await auth.cadastrar(nome.value, email.value, senha.value, convite.value);
    router.replace(route.query.volta || { name: 'inicio' });
  } finally {
    enviando.value = false;
  }
}
</script>
