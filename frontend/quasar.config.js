import { defineConfig } from '#q-app/wrappers';

export default defineConfig(() => ({
  boot: ['tema', 'axios'],
  css: ['app.scss'],
  extras: ['material-icons', 'roboto-font'],
  build: {
    target: { browser: ['es2022', 'firefox115', 'chrome115', 'safari14'], node: 'node22' },
    vueRouterMode: 'hash',
  },
  devServer: {
    port: 9000,
    open: false,
    proxy: { '/api': { target: 'http://localhost:3333', changeOrigin: true } },
  },
  framework: {
    lang: 'pt-BR',
    config: {
      brand: { primary: '#1d4ed8', secondary: '#0f766e', accent: '#f59e0b', dark: '#111827', 'dark-page': '#0b1120' },
      notify: { position: 'top-right', timeout: 3000 },
    },
    plugins: ['Notify', 'Dialog', 'Loading', 'LocalStorage'],
  },
}));
