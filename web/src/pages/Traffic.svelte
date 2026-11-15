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
    { key: 'query', label: 'Kata kunci', sortable: true, get: (r) => r.query },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Klik per tayangan', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 1)) },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => (r.position == null ? '—' : num(r.position)) },
  ];
  const rankCols = [
    { key: 'query', label: 'Kata kunci', sortable: true, get: (r) => r.query },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => num(r.position) },
    { key: 'delta', label: 'Perubahan', align: 'r', sortable: true, sortVal: (r) => r.delta ?? 0, chip: (r) => {
      const dl = r.delta;
      if (dl == null) return null;
      return dl > 0 ? { value: 'turun', label: '▲ ' + dl, kind: 'bad' } : dl < 0 ? { value: 'naik', label: '▼ ' + Math.abs(dl), kind: 'ok' } : { value: 'tetap', label: '—', kind: 'info' };
    } },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
  ];
</script>

<PageHead title="Trafik" sub="Kunjungan dan tayangan dari pencarian Google" />

{#if !t.available}
  <div class="callout info">Data kunjungan belum pernah dikumpulkan. Pengumpulan data berjalan otomatis setiap Senin pagi dengan koneksi Google — data 28 hari terakhir akan muncul di sini. Tidak ada angka yang dikarang.</div>
  <EmptyState icon="chart" title="Belum ada data trafik" note="Muncul setelah pengumpulan data mingguan berhasil dijalankan." />
{:else}
  <div class="grid g4">
    <Kpi i={0} label="Klik" value={t.clicks ?? 0} note="28 hari terakhir" tone="ok" />
    <Kpi i={1} label="Tayangan" value={t.impressions ?? 0} tone="teal" />
    <Kpi i={2} label="Kata kunci" value={t.queries ?? 0} tone="info" />
    <Kpi i={3} label="Klik per tayangan" value={t.impressions ? pct(t.clicks / t.impressions, 1) : '—'} />
  </div>
  <h2 class="sec">Kata kunci teratas (klik)</h2>
  <Card i={4}><BarChart items={topItems} /></Card>
  <h2 class="sec">Detail kata kunci</h2>
  <DataTable columns={topCols} rows={t.top || []} searchKeys={['query']} placeholder="Cari kata kunci…" />
{/if}

<h2 class="sec">Perubahan posisi</h2>
{#if !rank.available}
  <div class="callout info">Perubahan posisi kata kunci belum diukur. Pemantauan berjalan otomatis setiap Senin pagi dengan koneksi Google — hasilnya akan muncul di sini.</div>
{:else}
  <div class="grid g3">
    <Kpi i={0} label="Turun banyak (> {rank.threshold ?? 3} posisi)" value={(rank.drops || []).length} tone={(rank.drops || []).length ? 'bad' : 'ok'} />
    <Kpi i={1} label="Membaik" value={(rank.improved || []).length} tone="ok" />
    <Kpi i={2} label="Kata kunci dipantau" value={(rank.entries || []).length} />
  </div>
  <div style="margin-top:14px">
    <DataTable columns={rankCols} rows={rank.entries || []} searchKeys={['query']} placeholder="Cari query…" />
  </div>
{/if}