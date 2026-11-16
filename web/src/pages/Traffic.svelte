<script>
  import { data } from '../lib/state.svelte.js';
  import { num, pct, date } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Chip from '../components/Chip.svelte';
  import Card from '../components/Card.svelte';
  import BarChart from '../components/BarChart.svelte';
  import LineChart from '../components/LineChart.svelte';
  import DataTable from '../components/DataTable.svelte';

  const d = $derived(data.snapshot);
  const t = $derived(d?.traffic || {});
  const rank = $derived(d?.rank || {});
  const agg = $derived(d?.gsc?.agg || null);
  const hist = $derived(d?.gsc?.history || []);
  const topPages = $derived(d?.gsc?.topPages || []);
  const gscNote = $derived(d?.gsc?.historyNote || null);
  const connected = $derived(Boolean(agg || t.available));

  const impItems = $derived((t.top || []).slice(0, 8).map((q) => ({ label: q.query, value: q.impressions || 0, color: 'var(--sky)' })));

  const topCols = [
    { key: 'query', label: 'Kata kunci', sortable: true, get: (r) => r.query },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, sortVal: (r) => r.impressions ?? 0, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Rasio klik', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 1)) },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => (r.position == null ? '—' : num(r.position)) },
  ];
  const pageCols = [
    { key: 'page', label: 'Halaman', sortable: true, get: (r) => String(r.page || '').replace(/^https?:\/\/[^/]+/, '') || '/' },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Rasio klik', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 1)) },
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

<PageHead title="Trafik" sub="Klik, tayangan, rasio klik, dan posisi dari data Google (28 hari).">
  <Chip value={connected ? 'on' : 'off'} kind={connected ? 'ok' : 'warn'} label={connected ? 'terhubung' : 'menunggu data'} />
</PageHead>

{#if t.available}
  <div class="grid g2">
    <Card i={0} title="Kata kunci teratas" sub="28 hari · urut tayangan — klik baris untuk mencari">
      <DataTable columns={topCols} rows={t.top || []} searchKeys={['query']} placeholder="Cari kata kunci…" pageSize={50} />
    </Card>
    <Card i={1} title="Sebaran pencarian" sub="{num((t.top || []).length)} kata kunci teratas · per tayangan">
      {#if impItems.length}
        <BarChart items={impItems} />
      {:else}
        <p class="note">Belum ada tayangan tercatat untuk kata kunci mana pun.</p>
      {/if}
    </Card>
  </div>
{:else}
  <div class="callout info">Perincian kata kunci (28 hari) belum pernah dikumpulkan — pengumpulan berjalan otomatis tiap Senin pagi. Tidak ada angka yang dikarang.</div>
{/if}

{#if topPages.length}
  <h2 class="sec">Halaman teratas</h2>
  <DataTable columns={pageCols} rows={topPages} searchKeys={['page']} placeholder="Cari halaman…" />
{:else if agg}
  <h2 class="sec">Halaman teratas</h2>
  <div class="callout info">Data per-halaman dari Google belum pernah terkumpul untuk periode ini — angka yang tidak ada tidak ditampilkan.</div>
{/if}

{#if hist.length >= 2}
  <h2 class="sec">Tren posisi harian</h2>
  <Card i={2} title="Posisi rata-rata harian" sub="semakin kecil semakin dekat ke halaman pertama — digambar apa adanya">
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
