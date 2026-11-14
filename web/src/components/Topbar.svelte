<script>
  import Icon from './Icon.svelte';
  import { ui, router, data } from '../lib/state.svelte.js';
  const TITLES = { '/': 'Overview', '/traffic': 'Traffic', '/queue': 'Antrean', '/content': 'Konten', '/tracking': 'Tracking', '/urls': 'URL', '/indexasi': 'Indexasi', '/runs': 'Runs', '/health': 'Health', '/alerts': 'Alerts' };
  const title = $derived(TITLES[router.path] || 'Valley City');
</script>

<div class="topbar">
  <button class="icon-btn" onclick={() => (ui.drawerOpen = true)} aria-label="Buka menu"><Icon name="menu" /></button>
  <div class="brand-title">{title}</div>
  <div class="spacer"></div>
  <button class="icon-btn" onclick={() => data.refresh()} aria-label="Segarkan" disabled={data.loading}><Icon name="refresh" cls={data.loading ? 'spin' : ''} /></button>
  <button class="icon-btn" onclick={() => ui.toggleTheme()} aria-label="Tema"><Icon name={ui.dark ? 'sun' : 'moon'} /></button>
</div>