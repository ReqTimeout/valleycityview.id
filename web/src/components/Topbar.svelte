<script>
  import Icon from './Icon.svelte';
  import { ui, router, data } from '../lib/state.svelte.js';
  const TITLES = { '/': 'Beranda', '/traffic': 'Trafik', '/queue': 'Antrean', '/content': 'Konten', '/tracking': 'Kualitas', '/urls': 'URL', '/indexasi': 'Status Google', '/runs': 'Riwayat', '/health': 'Status Sistem', '/alerts': 'Perlu Perhatian', '/laporan': 'Laporan' };
  const title = $derived(TITLES[router.path] || 'Valley City');
  // Jam WIB — panil kecil di topbar supaya jendela kerja 08–16 terbaca jelas.
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 30000); return () => clearInterval(t); });
  const wibClock = $derived.by(() => {
    now;
    return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) + ' WIB';
  });
  // Pil status jendela terbit (sama seperti sbdental "di luar jam terbit").
  const sched = $derived(data.snapshot?.schedule || {});
  const winText = $derived(sched.halt ? 'terbit dihentikan' : sched.inWindow ? 'dalam jendela terbit' : 'di luar jam terbit');
</script>

<div class="topbar">
  <button class="icon-btn" onclick={() => (ui.drawerOpen = true)} aria-label="Buka menu"><Icon name="menu" /></button>
  <div class="brand-title">{title}</div>
  <div class="spacer"></div>
  {#if sched.startHour != null}
    <span class="win {sched.inWindow && !sched.halt ? 'on' : sched.halt ? 'halt' : ''}" title="Jendela terbit {sched.startHour}:00–{sched.endHour}:00 WIB · kuota {sched.dailyCount ?? '—'}/hari">{winText}</span>
  {/if}
  <span class="clock" title="Waktu Indonesia Barat">{wibClock}</span>
  <button class="icon-btn" onclick={() => data.refresh()} aria-label="Segarkan" disabled={data.loading}><Icon name="refresh" cls={data.loading ? 'spin' : ''} /></button>
  <button class="icon-btn" onclick={() => ui.toggleTheme()} aria-label="Tema"><Icon name={ui.dark ? 'sun' : 'moon'} /></button>
</div>
<style>
  .clock { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; padding: 0 6px; white-space: nowrap; }
  .win { font-size: 11.5px; font-weight: 600; padding: 4px 11px; border-radius: 999px; background: var(--surface-3); color: var(--ink-3); border: 1px solid var(--line); white-space: nowrap; margin-right: 4px; }
  .win.on { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
  .win.halt { background: var(--bad-soft); color: var(--bad); border-color: transparent; }
  @media (max-width: 760px) { .win { display: none; } }
  @media (max-width: 560px) { .clock { display: none; } }
</style>
