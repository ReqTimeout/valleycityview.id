<script>
  import { data, router } from '../lib/state.svelte.js';
  import { num } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Card from '../components/Card.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const s = $derived(d?.summary || {});

  const alerts = $derived.by(() => {
    const out = [];
    for (const a of s.alerts || []) out.push({ kind: 'bad', title: 'Alert mesin', body: typeof a === 'string' ? a : (a.message || JSON.stringify(a)), to: '/runs' });
    const missingCreds = (d?.credentials || []).filter((c) => !c.set);
    if (missingCreds.length) out.push({ kind: 'warn', title: `${missingCreds.length} kredensial belum terpasang`, body: missingCreds.map((c) => c.env).join(', ') + ' — langkah terkait akan skip jujur, bukan gagal diam-diam.', to: '/health' });
    if (d?.access && d.access.mode !== 'enforced') out.push({ kind: d.access.mode === 'not-configured' ? 'bad' : 'warn', title: 'Proteksi akses: ' + (d.access.label || d.access.mode), body: d.access.note, to: '/health' });
    if (d?.sitemap && !d.sitemap.exists) out.push({ kind: 'bad', title: 'Sitemap tidak ada', body: 'Mesin belum menghasilkan sitemap — URL tidak terdiscovery lewat sitemap.', to: '/health' });
    if ((d?.missing || []).length) out.push({ kind: 'warn', title: `${d.missing.length} URL tayang belum tercatat`, body: 'Ada konten tayang yang belum masuk state mesin. Jalankan indexer.', to: '/urls' });
    if ((d?.rank?.drops || []).length) out.push({ kind: 'warn', title: `${d.rank.drops.length} query turun posisi`, body: 'Perubahan posisi melebihi ambang. Tinjau di Traffic.', to: '/traffic' });
    if ((d?.tracking?.thin || []).length) out.push({ kind: 'info', title: `${d.tracking.thin.length} artikel tipis`, body: 'Artikel di bawah 900 kata — kandidat perluasan konten.', to: '/tracking' });
    return out;
  });
  const counts = $derived({ bad: alerts.filter((a) => a.kind === 'bad').length, warn: alerts.filter((a) => a.kind === 'warn').length, info: alerts.filter((a) => a.kind === 'info').length });
</script>

<PageHead title="Alerts" sub="Semua hal yang butuh perhatian — mesin, kredensial, proteksi, dan konten" />

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
          <div class="ac-body"><b>{a.title}</b><span>{a.body}</span></div>
          <Icon name="chevron" size={16} />
        </button>
      </Card>
    {/each}
  {:else}
    <EmptyState icon="check" title="Tidak ada alert" note="Mesin, kredensial, proteksi, dan konten dalam keadaan normal. Semua gerbang sehat." />
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
  .alert-card.bad :global(.ic:first-child) { color: var(--bad); }
  .alert-card.warn :global(.ic:first-child) { color: var(--warn); }
  .alert-card.info :global(.ic:first-child) { color: var(--info); }
  .alert-card :global(.ic:last-child) { color: var(--ink-4); }
</style>