// web/src/lib/state.svelte.js — state global runes (Svelte 5).
// Data: snapshot mesin. Router: history API. UI: tema/drawer/toast/konfirmasi.
import { fetchSnapshot, postAction } from './api.js';

const norm = (p) => {
  let x = String(p || '/').split('?')[0];
  if (x === '/index.html') x = '/';
  if (x.length > 1 && x.endsWith('/')) x = x.slice(0, -1);
  return x || '/';
};

class Data {
  snapshot = $state(null);
  loading = $state(true);
  error = $state(null);
  lastFetch = $state(0);
  busy = $state(null);

  async refresh() {
    this.loading = true;
    this.error = null;
    try {
      this.snapshot = await fetchSnapshot();
      this.lastFetch = Date.now();
    } catch (e) {
      if (e.status === 401) { location.href = '/login'; return; }
      this.error = e.message || 'Gagal memuat data';
    } finally {
      this.loading = false;
    }
  }

  async run(action, label) {
    if (this.busy) return;
    this.busy = action;
    try {
      const r = await postAction(action);
      if (r.ok) {
        ui.toast(r.msg || `${label} dimulai — pantau di Runs.`, 'ok');
        router.go(r.to || '/runs');
        setTimeout(() => this.refresh(), 1600);
        setTimeout(() => this.refresh(), 6000);
      } else {
        ui.toast(r.msg || 'Gagal memicu aksi.', 'bad');
      }
    } catch (e) {
      ui.toast('Gagal: ' + (e.message || 'kesalahan jaringan'), 'bad');
    } finally {
      this.busy = null;
    }
  }
}

class Router {
  path = $state(norm(location.pathname));
  init() {
    window.addEventListener('popstate', () => { this.path = norm(location.pathname); });
  }
  go(p) {
    const n = norm(p);
    if (n === this.path) { ui.drawerOpen = false; return; }
    history.pushState({}, '', n);
    this.path = n;
    window.scrollTo({ top: 0 });
    ui.drawerOpen = false;
  }
}

class UI {
  dark = $state(document.documentElement.classList.contains('dark'));
  drawerOpen = $state(false);
  toasts = $state([]);
  confirm = $state(null);

  toggleTheme() {
    this.dark = !this.dark;
    document.documentElement.classList.toggle('dark', this.dark);
    try { localStorage.setItem('vcv-theme', this.dark ? 'dark' : 'light'); } catch {}
  }
  toast(msg, kind = 'ok') {
    const id = Math.random().toString(36).slice(2);
    this.toasts = [...this.toasts, { id, msg, kind }];
    setTimeout(() => this.dismiss(id), 5200);
  }
  dismiss(id) { this.toasts = this.toasts.filter((t) => t.id !== id); }
  ask(opts) { this.confirm = opts; }
  closeConfirm() { this.confirm = null; }
}

export const data = new Data();
export const router = new Router();
export const ui = new UI();
router.init();