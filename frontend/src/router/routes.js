export default [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'inicio', component: () => import('pages/InicioPage.vue') },
      { path: 'oportunidades', name: 'oportunidades', component: () => import('pages/OportunidadesPage.vue') },
      { path: 'oportunidades/:id', name: 'oportunidade', component: () => import('pages/OportunidadePage.vue') },
      { path: 'negocios', name: 'negocios', component: () => import('pages/NegociosPage.vue') },
      { path: 'negocios/:id', name: 'negocio', component: () => import('pages/NegocioPage.vue') },
      { path: 'agenda', name: 'agenda', component: () => import('pages/AgendaPage.vue') },
      { path: 'documentos', name: 'documentos', component: () => import('pages/DocumentosPage.vue') },
      { path: 'alertas', name: 'alertas', component: () => import('pages/AlertasPage.vue') },
      { path: 'empresas', name: 'empresas', component: () => import('pages/EmpresasPage.vue') },
      { path: 'pagometro', name: 'pagometro', component: () => import('pages/PagometroPage.vue') },
    ],
  },
  { path: '/entrar', name: 'login', meta: { publica: true }, component: () => import('pages/LoginPage.vue') },
  { path: '/:catchAll(.*)*', redirect: '/' },
];
