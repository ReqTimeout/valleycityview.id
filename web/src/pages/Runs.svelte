<script>
  import { data, ui } from '../lib/state.svelte.js';
  import { num, ago, date, pct } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Drawer from '../components/Drawer.svelte';
  import Chip from '../components/Chip.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const runs = $derived(d?.runs || []);
  const audit = $derived(d?.audit || []);
  const hist = $derived(d?.gsc?.history || []);
  const gscNote = $derived(d?.gsc?.historyNote || null);
  let selected = $state(null);

  // Catatan metrik harian (30 hari) — dipindahkan dari Trafik supaya halaman
  // "Riwayat" = rekam jejak lengkap, sama seperti sbdental.
  const histCols = [
    { key: 'date', label: 'Tanggal', sortable: true, get: (r) => date(r.date) },
    { key: 'clicks', label: 'Klik', align: 'r', sortable: true, get: (r) => num(r.clicks) },
    { key: 'impressions', label: 'Tayangan', align: 'r', sortable: true, get: (r) => num(r.impressions) },
    { key: 'ctr', label: 'Rasio klik', align: 'r', sortable: true, get: (r) => (r.ctr == null ? '—' : pct(r.ctr, 2)) },
    { key: 'position', label: 'Posisi', align: 'r', sortable: true, get: (r) => (r.position == null ? '—' : num(r.position)) },
  ];

  const dur = (r) => {
    if (!r.finishedAt || !r.at) return '—';
    const ms = Date.parse(r.finishedAt) - Date.parse(r.at);
    return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
  };
  const exitChip = (r) => (r.exit === 0 ? { value: 'ok', label: 'sukses', kind: 'ok' } : r.exit == null ? { value: 'run', label: 'berjalan', kind: 'info' } : { value: 'fail', label: 'gagal', kind: 'bad' });
  const kindName = (k) => ({
    tick: 'Cek jadwal tayang',
    daily: 'Siklus harian',
    weekly: 'Data mingguan',
    watchdog: 'Pengawas mesin',
    rank: 'Pantau posisi',
    generate: 'Tulis draf',
    publish: 'Tayangkan',
    inspect: 'Periksa Google',
    bing: 'Kirim ke Bing',
  }[k] || k);
  const actionName = (a) => ({
    '/api/run-daily': 'Siklus harian',
    '/api/generate': 'Buat draf',
    '/api/publish': 'Tayangkan',
    '/api/inspect': 'Periksa Google',
  }[a] || a);
  const scriptName = (s) => ({
    'runner/daily.mjs': 'Siklus harian lengkap',
    'seo/generate.mjs': 'Penulis artikel',
    'seo/publish-git.mjs': 'Publikasi ke situs',
    'seo/publish.mjs': 'Publikasi ke situs',
    'seo/gsc-inspect.mjs': 'Pemeriksaan Google',
  }[s] || s);
  const stepName = (n) => ({
    bootstrap: 'Persiapan',
    indexer: 'Periksa & catat status',
    generate: 'Tulis draf artikel',
    publish: 'Tayangkan',
    report: 'Catat ringkasan',
  }[n] || n);
  const stepTone = (st) => ({ ok: 'ok', fail: 'bad', skip: 'info', blocked: 'warn' }[st] || 'info');
  const runCols = [
    { key: 'kind', label: 'Jenis kerja', sortable: true, get: (r) => kindName(r.kind) },
    { key: 'exit', label: 'Hasil', chip: exitChip },
    { key: 'at', label: 'Mulai', sortable: true, get: (r) => ago(r.at) },
    { key: 'dur', label: 'Durasi', align: 'r', get: dur },
    { key: 'steps', label: 'Tahap', align: 'r', get: (r) => num((r.steps || []).length) },
  ];
  const auditCols = [
    { key: 'at', label: 'Waktu', sortable: true, get: (r) => ago(r.at) },
    { key: 'user', label: 'Oleh', get: (r) => r.user || '—' },
    { key: 'action', label: 'Aksi', chip: (r) => ({ value: r.action, label: actionName(r.action), kind: 'info' }) },
    { key: 'script', label: 'Detail', get: (r) => scriptName(r.script) || '—' },
  ];
  function trigger(action, label, body) {
    ui.ask({ title: label + '?', body, action, label });
  }
</script>

<PageHead title="Riwayat" sub="Rekam jejak metrik harian + pekerjaan otomatis mesin">
  {#if hist.length}<Chip value="harian" kind="info" label="{hist.length} hari tercatat" />{/if}
</PageHead>

<div class="action-bar">
  <button class="btn gold" onclick={() => trigger('/api/run-daily', 'Jalankan siklus harian', 'Menjalankan seluruh siklus kerja harian: periksa status di Google, tulis draf artikel, tayangkan sesuai kuota, lalu catat ringkasan. Semua batas tetap berlaku.')} disabled={!!data.busy}><Icon name="play" size={16} /> Jalankan siklus harian</button>
  <button class="btn" onclick={() => trigger('/api/generate', 'Buat draf artikel', 'Membuat draf artikel baru dari kata kunci yang disetujui. Draf tidak langsung tayang — menunggu jadwal publikasi.')} disabled={!!data.busy}><Icon name="file" size={16} /> Buat draf artikel</button>
  <button class="btn" onclick={() => trigger('/api/publish', 'Tayangkan sekarang', 'Menayangkan artikel sesuai kuota harian yang berlaku (di luar jadwal tetap diizinkan lewat tombol ini).')} disabled={!!data.busy}><Icon name="up" size={16} /> Tayangkan sekarang</button>
</div>

<div class="grid g3" style="margin-top:16px">
  <Kpi i={0} label="Total pekerjaan" value={d?.runsTotal ?? runs.length} />
  <Kpi i={1} label="Pekerjaan terakhir" value={runs[0] ? ago(runs[0].at) : '—'} tone={runs[0] ? (runs[0].exit === 0 ? 'ok' : runs[0].exit == null ? 'info' : 'bad') : ''} note={runs[0] ? kindName(runs[0].kind) : 'belum pernah'} />
  <Kpi i={2} label="Aksi manual tercatat" value={audit.length} tone="teal" note="terbaru" />
</div>

<h2 class="sec">Riwayat harian</h2>
{#if hist.length}
  <DataTable columns={histCols} rows={[...hist].reverse()} searchKeys={['date']} placeholder="Cari tanggal…" pageSize={31} />
{:else}
  <div class="callout info">Catatan metrik harian diisi otomatis oleh siklus harian bersama pemeriksaan Google — {gscNote || 'belum pernah berjalan'}.</div>
{/if}

<h2 class="sec">Riwayat kerja otomatis</h2>
<DataTable columns={runCols} rows={runs} searchKeys={['kind']} placeholder="Cari jenis kerja…" onRowClick={(r) => (selected = r)} empty="Belum ada pekerjaan tercatat." />

<h2 class="sec">Aksi manual</h2>
<DataTable columns={auditCols} rows={audit} searchKeys={['user', 'action', 'script']} placeholder="Cari aksi / pengguna…" empty="Belum ada aksi manual tercatat." />

<Drawer open={!!selected} title="Pekerjaan: {kindName(selected?.kind) || ''}" sub={selected ? date(selected.at) : ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Hasil</dt><dd><Chip value={exitChip(selected).value} label={exitChip(selected).label} kind={exitChip(selected).kind} /></dd>
      <dt>Mulai</dt><dd>{date(selected.at)}</dd>
      <dt>Selesai</dt><dd>{selected.finishedAt ? date(selected.finishedAt) : '—'}</dd>
      <dt>Durasi</dt><dd>{dur(selected)}</dd>
      <dt>Dijalankan di</dt><dd>{selected.host || '—'}</dd>
      <dt>Sedang bekerja?</dt><dd>{selected.lock || '—'}</dd>
    </dl>
    {#if selected.lockNote}<div class="callout warn">{selected.lockNote}</div>{/if}
    <h2 class="sec">Tahapan</h2>
    <div class="steps">
      {#each selected.steps || [] as st, i}
        <div class="step">
          <Chip value={st.status} label={st.status} kind={stepTone(st.status)} />
          <span class="sn">{stepName(st.name)}</span>
          {#if st.note}<span class="snote">{st.note}</span>{/if}
        </div>
      {/each}
    </div>
    {#if selected.summary}
      <h2 class="sec">Ringkasan</h2>
      <dl class="kv">
        <dt>Tertayang</dt><dd>{num(selected.summary.published)}</dd>
        <dt>Diperiksa</dt><dd>{num(selected.summary.measured)}</dd>
        <dt>Masuk pencarian</dt><dd>{selected.summary.indexRate == null ? '—' : (Number(selected.summary.indexRate) * 100).toFixed(1) + '%'}</dd>
        <dt>Draf</dt><dd>{num(selected.summary.draft)}</dd>
      </dl>
    {/if}
  {/if}
</Drawer>

<style>
  .action-bar { display: flex; flex-wrap: wrap; gap: 10px; }
  .steps { display: flex; flex-direction: column; gap: 8px; }
  .step { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .sn { font-weight: 600; font-size: 13px; }
  .snote { color: var(--ink-3); font-size: 12px; flex-basis: 100%; padding-left: 2px; }
</style>