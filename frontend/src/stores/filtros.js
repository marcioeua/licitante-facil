import { defineStore } from 'pinia';
import { api } from 'boot/axios';

// Listas de UFs e modalidades vindas do backend (carregadas uma vez).
export const useFiltros = defineStore('filtros', {
  state: () => ({ ufs: [], modalidades: [], ultimaSincronizacao: null, empresas: [] }),
  actions: {
    async carregar() {
      if (this.ufs.length) return;
      Object.assign(this, (await api.get('/oportunidades/filtros')).data);
    },
    async carregarEmpresas() {
      this.empresas = (await api.get('/empresas')).data;
    },
  },
});
