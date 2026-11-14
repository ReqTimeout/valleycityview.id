<script>
  import { data } from '../lib/state.svelte.js';
  import { num, pct } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import BarChart from '../components/BarChart.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const d = $derived(data.snapshot);
  const t = $derived(d?.traffic || {});
  const rank = $derived(d?.rank || {});
  const topItems = $derived((t.top || []).map((q) => ({ label: q.query, value: q.clicks || 0 })));
  const topCols = [
    { key: 'query', label: 'Query', sortable: true, get: (r) => r.query },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Impresi', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'CTR', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 1)) },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => (r.position == null ? '—' : num(r.position)) },
  ];
  const rankCols = [
    { key: 'query', label: 'Query', sortable: true, get: (r) => r.query },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => num(r.position) },
    { key: 'delta', label: 'Perubahan', align: 'r', sortable: true, sortVal: (r) => r.delta ?? 0, chip: (r) => {
      const dl = r.delta;
      if (dl == null) return null;
      return dl > 0 ? { value: 'turun', label: '▲ ' + dl, kind: 'bad' } : dl < 0 ? { value: 'naik', label: '▼ ' + Math.abs(dl), kind: 'ok' } : { value: 'tetap', label: '—', kind: 'info' };
    } },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
  ];
</script>

<PageHead title="Traffic" sub="Klik & impresi dari Google Search Analytics" />

{#if !t.available}
  <div class="callout info">Search Analytics belum pernah ditambang. Jalankan <code>weekly</code> dengan kredensial GSC terpasang untuk mengisi halaman ini — tidak ada angka yang dikarang.</div>
  <EmptyState icon="chart" title="Belum ada data trafik" note="Window 28 hari akan muncul setelah weekly.mjs berhasil menambang GSC." />
{:else}
  <div class="grid g4">
    <Kpi i={0} label="Klik" value={t.clicks ?? 0} note="window {num(t.windowDays)} hari" tone="ok" />
    <Kpi i={1} label="Impresi" value={t.impressions ?? 0} tone="teal" />
    <Kpi i={2} label="Query" value={t.queries ?? 0} tone="info" />
    <Kpi i={3} label="CTR rata-rata" value={t.impressions ? pct(t.clicks / t.impressions, 1) : '—'} />
  </div>
  <h2 class="sec">Query teratas (klik)</h2>
  <Card i={4}><BarChart items={topItems} /></Card>
  <h2 class="sec">Detail query</h2>
  <DataTable columns={topCols} rows={t.top || []} searchKeys={['query']} placeholder="Cari query…" />
{/if}

<h2 class="sec">Rank tracking</h2>
{#if !rank.available}
  <div class="callout info">Posisi kata kunci belum ditambang ({rank.reason || 'belum pernah'}). Jalankan <code>seo/rank.mjs</code> dengan GSC terpasang untuk melihat perubahan posisi.</div>
{:else}
  <div class="grid g3">
    <Kpi i={0} label="Turun > {rank.threshold ?? 3}" value={(rank.drops || []).length} tone={(rank.drops || []).length ? 'bad' : 'ok'} />
    <Kpi i={1} label="Membaik" value={(rank.improved || []).length} tone="ok" />
    <Kpi i={2} label="Query dipantau" value={(rank.entries || []).length} />
  </div>
  <div style="margin-top:14px">
    <DataTable columns={rankCols} rows={rank.entries || []} searchKeys={['query']} placeholder="Cari query…" />
  </div>
{/if}