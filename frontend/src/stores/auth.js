import { defineStore } from 'pinia';
import { api } from 'boot/axios';

export const useAuth = defineStore('auth', {
  state: () => ({ usuario: null, carregado: false }),
  actions: {
    async carregar() {
      if (this.carregado) return this.usuario;
      try {
        this.usuario = (await api.get('/auth/me', { silencioso: true })).data;
      } catch {
        this.usuario = null;
      }
      this.carregado = true;
      return this.usuario;
    },
    async login(email, senha) {
      this.usuario = (await api.post('/auth/login', { email, senha })).data;
      this.carregado = true;
    },
    async cadastrar(nome, email, senha) {
      this.usuario = (await api.post('/auth/cadastro', { nome, email, senha })).data;
      this.carregado = true;
    },
    async sair() {
      await api.post('/auth/logout');
      this.usuario = null;
    },
  },
});
