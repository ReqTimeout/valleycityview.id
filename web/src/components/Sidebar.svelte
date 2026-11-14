<script>
  import Icon from './Icon.svelte';
  import { router, ui, data } from '../lib/state.svelte.js';
  import { ago } from '../lib/format.js';

  const NAV = [
    { group: 'Pantauan', items: [
      { href: '/', label: 'Overview', icon: 'home' },
      { href: '/traffic', label: 'Traffic', icon: 'chart' },
      { href: '/tracking', label: 'Tracking', icon: 'target' },
    ] },
    { group: 'Produksi', items: [
      { href: '/queue', label: 'Antrean', icon: 'list' },
      { href: '/content', label: 'Konten', icon: 'file' },
      { href: '/runs', label: 'Runs', icon: 'play' },
    ] },
    { group: 'Indexing', items: [
      { href: '/urls', label: 'URL', icon: 'link' },
      { href: '/indexasi', label: 'Indexasi', icon: 'search' },
    ] },
    { group: 'Sistem', items: [
      { href: '/health', label: 'Health', icon: 'activity' },
      { href: '/alerts', label: 'Alerts', icon: 'bell' },
    ] },
  ];
  const d = $derived(data.snapshot);
  const badges = $derived({
    '/queue': d?.keywords?.unused || null,
    '/content': d?.counts?.drafts || null,
  });
  const halt = $derived(Boolean(d?.config?.halt));
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18" /><path d="M5 20l4-9 3 5 2-3 5 7" /><path d="M14 6h3v3" /><path d="M17 6l-4 4" /></svg>
    </div>
    <div style="min-width:0">
      <div class="brand-title">Valley City <span class="accent">SEO</span></div>
      <div class="brand-sub">{d?.site || 'valleycityview.id'}</div>
    </div>
  </div>

  {#each NAV as g}
    <div class="nav-group">
      <div class="nav-label">{g.group}</div>
      {#each g.items as n}
        <button class="nav-item" aria-current={router.path === n.href ? 'page' : undefined} onclick={() => router.go(n.href)}>
          <Icon name={n.icon} />{n.label}
          {#if badges[n.href]}<span class="nav-badge">{badges[n.href]}</span>{/if}
        </button>
      {/each}
    </div>
  {/each}

  <div class="side-foot">
    <div class="status-dot {halt ? 'bad' : d?.lock?.held ? 'closed' : ''}">
      <span class="dot"></span>{halt ? 'Pipeline di-halt' : d?.lock?.held ? 'Lock aktif' : 'Mesin siap'}
    </div>
    <div class="side-meta">Snapshot {ago(d?.generatedAt)}</div>
    <div class="side-actions">
      <span class="user-chip" title={d?.user || 'tamu'}>{d?.user || 'tamu'}</span>
      <button class="icon-btn" onclick={() => ui.toggleTheme()} aria-label={ui.dark ? 'Mode terang' : 'Mode gelap'}><Icon name={ui.dark ? 'sun' : 'moon'} /></button>
      <form method="POST" action="/logout" style="display:inline-flex">
        <button class="icon-btn" aria-label="Keluar"><Icon name="logout" /></button>
      </form>
    </div>
  </div>
</aside>