import { defineRouter } from '#q-app/wrappers';
import { createRouter, createWebHashHistory } from 'vue-router';
import routes from './routes';
import { useAuth } from 'stores/auth';

export default defineRouter(() => {
  const router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createWebHashHistory(),
  });
  router.beforeEach(async (to) => {
    const auth = useAuth();
    await auth.carregar();
    if (!to.meta.publica && !auth.usuario) return { name: 'login', query: { volta: to.fullPath } };
    if (to.meta.publica && auth.usuario) return { name: 'inicio' };
  });
  return router;
});
