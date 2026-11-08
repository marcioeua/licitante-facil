// Tema claro/escuro/automático (segue o aparelho). A escolha fica guardada no navegador.
import { Dark } from 'quasar';

export const TEMAS = { claro: false, escuro: true, auto: 'auto' };

export function temaSalvo() {
  try { return localStorage.getItem('tema') ?? 'claro'; } catch { return 'claro'; }
}

export function definirTema(tema) {
  const t = TEMAS[tema] === undefined ? 'claro' : tema;
  Dark.set(TEMAS[t]);
  try { localStorage.setItem('tema', t); } catch { /* sem armazenamento */ }
  return t;
}

export default () => { definirTema(temaSalvo()); };
