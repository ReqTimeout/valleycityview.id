<script>
  import { data, router } from '../lib/state.svelte.js';
  import { num, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Card from '../components/Card.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Chip from '../components/Chip.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const s = $derived(d?.summary || {});

  const alerts = $derived.by(() => {
    const out = [];
    const snapAt = d?.generatedAt || null;
    for (const a of s.alerts || []) out.push({ kind: a?.level === 'critical' ? 'bad' : a?.level === 'warn' ? 'warn' : 'bad', title: 'Catatan mesin' + (a?.code ? ` · ${a.code}` : ''), body: typeof a === 'string' ? a : (a.msg || a.message || JSON.stringify(a)), at: a?.at || d?.ramp?.lastRun?.at || snapAt, to: '/runs' });
    const missingCreds = (d?.credentials || []).filter((c) => !c.set);
    if (missingCreds.length) out.push({ kind: 'warn', title: `${missingCreds.length} koneksi belum terpasang`, body: missingCreds.map((c) => c.role).join(', ') + ' — pekerjaan yang membutuhkannya dilewati dan dilaporkan jujur.', at: snapAt, to: '/health' });
    if (d?.access && d.access.mode !== 'enforced') out.push({ kind: d.access.mode === 'not-configured' ? 'bad' : 'warn', title: 'Pelindung ekstra: ' + (d.access.label || d.access.mode), body: d.access.note, at: d.access.checkedAt || snapAt, to: '/health' });
    if (d?.sitemap && !d.sitemap.exists) out.push({ kind: 'bad', title: 'Daftar alamat untuk Google belum ada', body: 'Tanpa daftar ini artikel bisa lambat ditemukan Google. Daftar dibuat otomatis saat situs di-build.', at: d.sitemap.checkedAt || snapAt, to: '/health' });
    if ((d?.missing || []).length) out.push({ kind: 'warn', title: `${d.missing.length} artikel tayang belum tercatat`, body: 'Pencatatan berjalan otomatis tiap pagi — jika masih muncul besok, periksa di Riwayat.', at: snapAt, to: '/urls' });
    if ((d?.rank?.drops || []).length) out.push({ kind: 'warn', title: `${d.rank.drops.length} kata kunci turun posisi`, body: 'Penurunan melebihi ambang normal. Tinjau di halaman Trafik.', at: d.rank.lastRun || snapAt, to: '/traffic' });
    if ((d?.tracking?.thin || []).length) out.push({ kind: 'info', title: `${d.tracking.thin.length} artikel masih pendek`, body: 'Artikel di bawah 900 kata — kandidat untuk diperpanjang.', at: snapAt, to: '/tracking' });
    return out;
  });
  const counts = $derived({ bad: alerts.filter((a) => a.kind === 'bad').length, warn: alerts.filter((a) => a.kind === 'warn').length, info: alerts.filter((a) => a.kind === 'info').length });
</script>

<PageHead title="Perlu Perhatian" sub="Semua hal yang perlu dilihat — mesin, koneksi, proteksi, dan konten">
  <Chip value="n" kind={counts.bad ? 'bad' : counts.warn ? 'warn' : 'ok'} label={counts.bad + counts.warn + counts.info ? `${counts.bad + counts.warn + counts.info} catatan` : 'semua baik'} />
</PageHead>

<div class="grid g3">
  <div class="alert-sum bad"><Icon name="alert" size={18} /><div><b>{counts.bad}</b><span>kritis</span></div></div>
  <div class="alert-sum warn"><Icon name="alert" size={18} /><div><b>{counts.warn}</b><span>perhatian</span></div></div>
  <div class="alert-sum info"><Icon name="info" size={18} /><div><b>{counts.info}</b><span>info</span></div></div>
</div>

<div style="margin-top:16px">
  {#if alerts.length}
    {#each alerts as a, i}
      <Card i={i}>
        <button class="alert-card {a.kind}" onclick={() => a.to && router.go(a.to)}>
          <Icon name={a.kind === 'info' ? 'info' : 'alert'} size={18} />
          <div class="ac-body"><b>{a.title}</b><span>{a.body}</span>{#if a.at}<span class="ac-time">dicek {ago(a.at)}</span>{/if}</div>
          <Icon name="chevron" size={16} />
        </button>
      </Card>
    {/each}
  {:else}
    <EmptyState icon="check" title="Tidak ada yang perlu diperhatikan" note="Mesin, koneksi, proteksi, dan konten berjalan normal." />
  {/if}
</div>

<style>
  .alert-sum { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-radius: var(--r); border: 1px solid var(--line); background: var(--surface); }
  .alert-sum b { font-size: 26px; font-weight: 700; display: block; line-height: 1; }
  .alert-sum span { font-size: 12px; color: var(--ink-3); }
  .alert-sum.bad :global(.ic) { color: var(--bad); } .alert-sum.warn :global(.ic) { color: var(--warn); } .alert-sum.info :global(.ic) { color: var(--info); }
  .alert-card { display: flex; align-items: center; gap: 12px; width: 100%; border: none; background: none; cursor: pointer; text-align: left; padding: 2px; }
  .alert-card .ac-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .alert-card b { font-size: 14px; }
  .alert-card span { font-size: 12.5px; color: var(--ink-3); }
  .alert-card .ac-time { font-size: 11px; color: var(--ink-4); margin-top: 2px; }
  .alert-card.bad :global(.ic:first-child) { color: var(--bad); }
  .alert-card.warn :global(.ic:first-child) { color: var(--warn); }
  .alert-card.info :global(.ic:first-child) { color: var(--info); }
  .alert-card :global(.ic:last-child) { color: var(--ink-4); }
</style>