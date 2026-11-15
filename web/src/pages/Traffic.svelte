<script>
  import { data } from '../lib/state.svelte.js';
  import { num, pct, date } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import BarChart from '../components/BarChart.svelte';
  import LineChart from '../components/LineChart.svelte';
  import DataTable from '../components/DataTable.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const d = $derived(data.snapshot);
  const t = $derived(d?.traffic || {});
  const rank = $derived(d?.rank || {});
  const agg = $derived(d?.gsc?.agg || null);
  const hist = $derived(d?.gsc?.history || []);
  const topPages = $derived(d?.gsc?.topPages || []);
  const gscNote = $derived(d?.gsc?.historyNote || null);

  const topItems = $derived((t.top || []).map((q) => ({ label: q.query, value: q.clicks || 0 })));
  const impItems = $derived((t.top || []).slice(0, 10).map((q) => ({ label: q.query, value: q.impressions || 0, color: 'var(--sky)' })));

  const topCols = [
    { key: 'query', label: 'Kata kunci', sortable: true, get: (r) => r.query },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Klik per tayangan', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 1)) },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => (r.position == null ? '—' : num(r.position)) },
  ];
  const pageCols = [
    { key: 'page', label: 'Halaman', sortable: true, get: (r) => String(r.page || '').replace(/^https?:\/\/[^/]+/, '') || '/' },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Klik per tayangan', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 1)) },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => (r.position == null ? '—' : num(r.position)) },
  ];
  const histCols = [
    { key: 'date', label: 'Tanggal', sortable: true, get: (r) => date(r.date) },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Klik per tayangan', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 2)) },
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

<div class="grid g4">
  <Kpi i={0} label="Klik" value={agg ? agg.clicks : (t.available ? t.clicks : null)} note={agg ? `periode ${agg.period?.start} → ${agg.period?.end}` : (t.available ? '28 hari (kata kunci)' : 'menunggu pengukuran')} tone="ok" />
  <Kpi i={1} label="Tayangan" value={agg ? agg.impressions : (t.available ? t.impressions : null)} tone="teal" />
  <Kpi i={2} label="Rasio klik" value={agg ? (agg.ctr == null ? '—' : pct(agg.ctr, 2)) : (t.available && t.impressions ? pct(t.clicks / t.impressions, 1) : '—')} tone="info" />
  <Kpi i={3} label="Posisi rata-rata" value={agg ? (agg.position ?? '—') : null} note={agg ? 'tertimbang tayangan, 30 hari' : (gscNote || 'menunggu pengukuran')} tone="warn" />
</div>

{#if hist.length >= 2}
  <h2 class="sec">Tren posisi harian</h2>
  <Card i={4} title="Posisi rata-rata harian" sub="makin kecil makin dekat halaman pertama — digambar apa adanya">
    <LineChart
      labels={hist.map((x) => x.date)}
      series={[{ key: 'position', label: 'Posisi', color: 'var(--teal)', fill: true }]}
      values={{ position: hist.map((x) => x.position) }}
      yReverse
      formatLeft={(v) => num(Math.round(v * 10) / 10)}
      empty={gscNote || 'Belum ada pengukuran.'}
    />
  </Card>
{/if}

{#if !t.available}
  <div class="callout info">Perincian kata kunci (28 hari) belum pernah dikumpulkan — pengumpulan berjalan otomatis tiap Senin pagi. Tidak ada angka yang dikarang.</div>
{:else}
  <h2 class="sec">Sebaran pencarian</h2>
  <div class="grid g2">
    <Card i={5} title="Kata kunci teratas (klik)"><BarChart items={topItems} /></Card>
    <Card i={6} title="Sebaran tayangan" sub="10 kata kunci paling sering muncul"><BarChart items={impItems} /></Card>
  </div>
  <h2 class="sec">Detail kata kunci</h2>
  <DataTable columns={topCols} rows={t.top || []} searchKeys={['query']} placeholder="Cari kata kunci…" />
{/if}

{#if topPages.length}
  <h2 class="sec">Halaman teratas</h2>
  <DataTable columns={pageCols} rows={topPages} searchKeys={['page']} placeholder="Cari halaman…" />
{/if}

{#if hist.length}
  <h2 class="sec">Riwayat harian</h2>
  <DataTable columns={histCols} rows={[...hist].reverse()} searchKeys={['date']} placeholder="Cari tanggal…" />
{:else}
  <div class="callout info">Riwayat metrik harian diisi otomatis oleh Siklus harian bersama pemeriksaan Google — {gscNote || 'belum pernah berjalan'}.</div>
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
