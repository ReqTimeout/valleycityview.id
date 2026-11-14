<script>
  import { data } from '../lib/state.svelte.js';
  import { num, date, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Drawer from '../components/Drawer.svelte';
  import Chip from '../components/Chip.svelte';

  const d = $derived(data.snapshot);
  const rows = $derived(d?.urlRows || []);
  const missing = $derived(d?.missing || []);
  let selected = $state(null);

  const toneOf = (l) => ({ indexed: 'ok', not_indexed: 'bad', not_discovered: 'warn', blocked: 'clay', redirected: 'info' }[l] || 'info');
  const indexedCount = $derived(rows.filter((r) => r.label === 'indexed').length);
  const cols = [
    { key: 'slug', label: 'Slug', sortable: true, get: (r) => r.slug },
    { key: 'label', label: 'Status indeks', chip: (r) => ({ value: r.label, label: r.label.replace(/_/g, ' '), kind: toneOf(r.label) }) },
    { key: 'submitted', label: 'IndexNow', chip: (r) => (r.submitted ? { value: 'ya', label: 'terkirim', kind: 'ok' } : { value: 'tidak', label: 'belum', kind: 'info' }) },
    { key: 'lastChecked', label: 'Dicek', sortable: true, get: (r) => (r.lastChecked ? ago(r.lastChecked) : '—') },
    { key: 'firstSeen', label: 'Pertama terlihat', sortable: true, get: (r) => date(r.firstSeen) },
  ];
</script>

<PageHead title="URL" sub="URL tayang yang tercatat mesin — status indeks & pengiriman IndexNow" />

<div class="grid g4">
  <Kpi i={0} label="URL tercatat" value={rows.length} />
  <Kpi i={1} label="Terindeks" value={indexedCount} tone="ok" note="{rows.length ? num(Math.round((indexedCount / rows.length) * 100)) : 0}% dari tercatat" />
  <Kpi i={2} label="IndexNow terkirim" value={d?.indexnow?.submitted ?? 0} tone="teal" />
  <Kpi i={3} label="Belum tercatat" value={missing.length} tone={missing.length ? 'warn' : 'ok'} note="tayang tapi tak ada di state" />
</div>

{#if missing.length}
  <div class="callout warn" style="margin-top:14px">{missing.length} URL tayang belum pernah tercatat mesin ({missing.slice(0, 3).map((m) => m.slug).join(', ')}{missing.length > 3 ? ', …' : ''}). Jalankan indexer agar masuk state.</div>
{/if}

<h2 class="sec">Daftar URL</h2>
<DataTable columns={cols} rows={rows} searchKeys={['slug', 'url', 'label']} placeholder="Cari slug / URL / status…" onRowClick={(r) => (selected = r)} />

<Drawer open={!!selected} title={selected?.slug || ''} sub={selected?.url || ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Status indeks</dt><dd><Chip value={selected.label} label={selected.label.replace(/_/g, ' ')} kind={toneOf(selected.label)} /></dd>
      <dt>Verdict GSC</dt><dd>{selected.verdict || '—'}</dd>
      <dt>Coverage state</dt><dd>{selected.coverageState || '—'}</dd>
      <dt>Crawl terakhir</dt><dd>{selected.lastCrawlTime ? date(selected.lastCrawlTime) : '—'}</dd>
      <dt>Dicek terakhir</dt><dd>{selected.lastChecked ? date(selected.lastChecked) : '—'}</dd>
      <dt>Pertama terlihat</dt><dd>{date(selected.firstSeen)}</dd>
      <dt>IndexNow</dt><dd>{selected.submitted ? 'Terkirim' : 'Belum'}</dd>
    </dl>
    <a class="btn ghost sm" style="margin-top:14px" href={selected.url} target="_blank" rel="noopener">Buka URL ↗</a>
  {/if}
</Drawer>