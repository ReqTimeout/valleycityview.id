<script>
  import { data, router, ui } from './lib/state.svelte.js';
  import Sidebar from './components/Sidebar.svelte';
  import Topbar from './components/Topbar.svelte';
  import Dock from './components/Dock.svelte';
  import Toasts from './components/Toasts.svelte';
  import Confirm from './components/Confirm.svelte';
  import Overview from './pages/Overview.svelte';
  import Traffic from './pages/Traffic.svelte';
  import Queue from './pages/Queue.svelte';
  import Content from './pages/Content.svelte';
  import Tracking from './pages/Tracking.svelte';
  import Urls from './pages/Urls.svelte';
  import Indexasi from './pages/Indexasi.svelte';
  import Runs from './pages/Runs.svelte';
  import Health from './pages/Health.svelte';
  import Alerts from './pages/Alerts.svelte';

  const PAGES = { '/': Overview, '/traffic': Traffic, '/queue': Queue, '/content': Content, '/tracking': Tracking, '/urls': Urls, '/indexasi': Indexasi, '/runs': Runs, '/health': Health, '/alerts': Alerts };
  const TITLES = { '/': 'Overview', '/traffic': 'Traffic', '/queue': 'Antrean', '/content': 'Konten', '/tracking': 'Tracking', '/urls': 'URL', '/indexasi': 'Indexasi', '/runs': 'Runs', '/health': 'Health', '/alerts': 'Alerts' };
  const Page = $derived(PAGES[router.path] || Overview);
  const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M5 20l4-9 3 5 2-3 5 7"/><path d="M14 6h3v3"/><path d="M17 6l-4 4"/></svg>';

  $effect(() => { document.body.classList.toggle('drawer-open', ui.drawerOpen); });
  $effect(() => { document.title = (TITLES[router.path] || 'Overview') + ' · Valley City SEO'; });
  $effect(() => {
    const handler = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('/login') || href.startsWith('/logout') || href.startsWith('/assets') || a.target === '_blank') return;
      e.preventDefault();
      router.go(href);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  });

  data.refresh();
</script>

{#if !data.snapshot && data.loading}
  <div class="boot"><div class="inner"><div class="brand-mark">{@html MARK}</div><div class="brand-title">Valley City <span class="accent">SEO</span></div><p>Memuat keadaan mesin…</p></div></div>
{:else if !data.snapshot && data.error}
  <div class="boot"><div class="inner"><div class="brand-mark">{@html MARK}</div><div class="brand-title">Valley City <span class="accent">SEO</span></div><p>Gagal memuat: {data.error}</p><button class="btn gold" style="margin-top:14px" onclick={() => data.refresh()}>Coba lagi</button></div></div>
{:else}
  <div class="shell">
    <Sidebar />
    <div class="scrim" role="button" tabindex="-1" aria-label="Tutup menu" onclick={() => (ui.drawerOpen = false)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') ui.drawerOpen = false; }}></div>
    <div class="main">
      <Topbar />
      <div class="content"><Page /></div>
    </div>
    <Dock />
  </div>
{/if}
<Toasts />
<Confirm />