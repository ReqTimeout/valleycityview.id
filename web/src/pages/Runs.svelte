<script>
  import { data, ui } from '../lib/state.svelte.js';
  import { num, ago, date } from '../lib/format.js';
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
  let selected = $state(null);

  const dur = (r) => {
    if (!r.finishedAt || !r.at) return '—';
    const ms = Date.parse(r.finishedAt) - Date.parse(r.at);
    return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
  };
  const exitChip = (r) => (r.exit === 0 ? { value: 'ok', label: 'sukses', kind: 'ok' } : r.exit == null ? { value: 'run', label: 'berjalan', kind: 'info' } : { value: 'fail', label: 'gagal (' + r.exit + ')', kind: 'bad' });
  const stepTone = (st) => ({ ok: 'ok', fail: 'bad', skip: 'info', blocked: 'warn' }[st] || 'info');
  const runCols = [
    { key: 'kind', label: 'Jenis', sortable: true, get: (r) => r.kind },
    { key: 'exit', label: 'Hasil', chip: exitChip },
    { key: 'at', label: 'Mulai', sortable: true, get: (r) => ago(r.at) },
    { key: 'dur', label: 'Durasi', align: 'r', get: dur },
    { key: 'steps', label: 'Tahap', align: 'r', get: (r) => num((r.steps || []).length) },
  ];
  const auditCols = [
    { key: 'at', label: 'Waktu', sortable: true, get: (r) => ago(r.at) },
    { key: 'user', label: 'Oleh', get: (r) => r.user || '—' },
    { key: 'action', label: 'Aksi', chip: (r) => ({ value: r.action, label: r.action, kind: 'info' }) },
    { key: 'script', label: 'Skrip', get: (r) => r.script || '—' },
  ];
  function trigger(action, label, body) {
    ui.ask({ title: label + '?', body, action, label });
  }
</script>

<PageHead title="Runs" sub="Picu pipeline dan pantau riwayat eksekusi + jejak audit" />

<div class="action-bar">
  <button class="btn gold" onclick={() => trigger('/api/run-daily', 'Jalankan pipeline harian', 'Menjalankan runner/daily.mjs: indexer → generate → publish → report. Gerbang keyword & kuota tetap berlaku.')} disabled={!!data.busy}><Icon name="play" size={16} /> Pipeline harian</button>
  <button class="btn" onclick={() => trigger('/api/generate', 'Generate draft', 'Menjalankan seo/generate.mjs untuk membuat draft dari keyword disetujui. Tidak publish.')} disabled={!!data.busy}><Icon name="file" size={16} /> Generate draft</button>
  <button class="btn" onclick={() => trigger('/api/publish', 'Publish', 'Menjalankan publish sesuai kuota harian dari config. Di container memakai publish-git (butuh GITHUB_TOKEN).')} disabled={!!data.busy}><Icon name="up" size={16} /> Publish</button>
</div>

<div class="grid g3" style="margin-top:16px">
  <Kpi i={0} label="Total run tercatat" value={d?.runsTotal ?? runs.length} />
  <Kpi i={1} label="Run terakhir" value={runs[0] ? ago(runs[0].at) : '—'} tone={runs[0] ? (runs[0].exit === 0 ? 'ok' : runs[0].exit == null ? 'info' : 'bad') : ''} note={runs[0] ? runs[0].kind : 'belum pernah'} />
  <Kpi i={2} label="Jejak audit" value={audit.length} tone="teal" note="mutasi terbaru" />
</div>

<h2 class="sec">Riwayat run</h2>
<DataTable columns={runCols} rows={runs} searchKeys={['kind']} placeholder="Cari jenis run…" onRowClick={(r) => (selected = r)} empty="Belum ada run tercatat." />

<h2 class="sec">Jejak audit (mutasi)</h2>
<DataTable columns={auditCols} rows={audit} searchKeys={['user', 'action', 'script']} placeholder="Cari aksi / skrip / user…" empty="Belum ada mutasi tercatat." />

<Drawer open={!!selected} title="Run {selected?.kind || ''}" sub={selected ? date(selected.at) : ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Hasil</dt><dd><Chip value={exitChip(selected).value} label={exitChip(selected).label} kind={exitChip(selected).kind} /></dd>
      <dt>Mulai</dt><dd>{date(selected.at)}</dd>
      <dt>Selesai</dt><dd>{selected.finishedAt ? date(selected.finishedAt) : '—'}</dd>
      <dt>Durasi</dt><dd>{dur(selected)}</dd>
      <dt>Host</dt><dd>{selected.host || '—'}</dd>
      <dt>Lock</dt><dd>{selected.lock || '—'}</dd>
    </dl>
    {#if selected.lockNote}<div class="callout warn">{selected.lockNote}</div>{/if}
    <h2 class="sec">Tahapan</h2>
    <div class="steps">
      {#each selected.steps || [] as st, i}
        <div class="step">
          <Chip value={st.status} label={st.status} kind={stepTone(st.status)} />
          <span class="sn">{st.name}</span>
          {#if st.note}<span class="snote">{st.note}</span>{/if}
        </div>
      {/each}
    </div>
    {#if selected.summary}
      <h2 class="sec">Ringkasan</h2>
      <dl class="kv">
        <dt>Published</dt><dd>{num(selected.summary.published)}</dd>
        <dt>Terukur</dt><dd>{num(selected.summary.measured)}</dd>
        <dt>Index rate</dt><dd>{selected.summary.indexRate == null ? '—' : selected.summary.indexRate}</dd>
        <dt>Draft</dt><dd>{num(selected.summary.draft)}</dd>
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