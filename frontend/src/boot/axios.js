import { defineBoot } from '#q-app/wrappers';
import axios from 'axios';
import { Notify } from 'quasar';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

export default defineBoot(({ app, router }) => {
  api.interceptors.response.use(
    (r) => r,
    (err) => {
      const status = err.response?.status;
      if (status === 401 && !err.config.url.startsWith('/auth/')) {
        router.push({ name: 'login', query: { volta: router.currentRoute.value.fullPath } });
      } else if (!err.config.silencioso) {
        Notify.create({ type: 'negative', message: err.response?.data?.erro ?? 'Não foi possível concluir. Verifique sua conexão.' });
      }
      return Promise.reject(err);
    },
  );
  app.config.globalProperties.$api = api;
});
