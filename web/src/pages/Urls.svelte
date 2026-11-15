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
  const humanLabel = (l) => ({ indexed: 'masuk pencarian', not_indexed: 'belum masuk', not_discovered: 'belum ditemukan', blocked: 'diblokir', redirected: 'dialihkan', unknown: 'belum diperiksa' }[l] || l.replace(/_/g, ' '));
  const indexedCount = $derived(rows.filter((r) => r.label === 'indexed').length);
  const cols = [
    { key: 'slug', label: 'Alamat', sortable: true, get: (r) => r.slug },
    { key: 'label', label: 'Status di Google', chip: (r) => ({ value: r.label, label: humanLabel(r.label), kind: toneOf(r.label) }) },
    { key: 'submitted', label: 'Kirim cepat', chip: (r) => (r.submitted ? { value: 'ya', label: 'terkirim', kind: 'ok' } : { value: 'tidak', label: 'belum', kind: 'info' }) },
    { key: 'lastChecked', label: 'Diperiksa', sortable: true, get: (r) => (r.lastChecked ? ago(r.lastChecked) : '—') },
    { key: 'firstSeen', label: 'Tayang sejak', sortable: true, get: (r) => date(r.firstSeen) },
  ];
</script>

<PageHead title="URL" sub="Alamat yang tayang — status di Google dan pengiriman cepat" />

<div class="grid g4">
  <Kpi i={0} label="Alamat tayang" value={rows.length} />
  <Kpi i={1} label="Masuk pencarian" value={indexedCount} tone="ok" note="{rows.length ? num(Math.round((indexedCount / rows.length) * 100)) : 0}% dari alamat tayang" />
  <Kpi i={2} label="Kirim cepat terkirim" value={d?.indexnow?.submitted ?? 0} tone="teal" />
  <Kpi i={3} label="Belum masuk pencatatan" value={missing.length} tone={missing.length ? 'warn' : 'ok'} note="tayang tapi belum dicatat otomatis" />
</div>

{#if missing.length}
  <div class="callout warn" style="margin-top:14px">{missing.length} artikel tayang belum masuk pencatatan otomatis ({missing.slice(0, 3).map((m) => m.slug).join(', ')}{missing.length > 3 ? ', …' : ''}). Pencatatan berjalan sendiri tiap pagi — jika masih muncul besok, buka halaman Riwayat.</div>
{/if}

<h2 class="sec">Daftar alamat</h2>
<DataTable columns={cols} rows={rows} searchKeys={['slug', 'url', 'label']} placeholder="Cari alamat / status…" onRowClick={(r) => (selected = r)} />

<Drawer open={!!selected} title={selected?.slug || ''} sub={selected?.url || ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Status di Google</dt><dd><Chip value={selected.label} label={humanLabel(selected.label)} kind={toneOf(selected.label)} /></dd>
      <dt>Kesimpulan Google</dt><dd>{selected.verdict || '—'}</dd>
      <dt>Keterangan Google</dt><dd>{selected.coverageState || '—'}</dd>
      <dt>Terakhir dikunjungi Google</dt><dd>{selected.lastCrawlTime ? date(selected.lastCrawlTime) : '—'}</dd>
      <dt>Diperiksa terakhir</dt><dd>{selected.lastChecked ? date(selected.lastChecked) : '—'}</dd>
      <dt>Tayang sejak</dt><dd>{date(selected.firstSeen)}</dd>
      <dt>Kirim cepat</dt><dd>{selected.submitted ? 'Terkirim' : 'Belum'}</dd>
    </dl>
    <a class="btn ghost sm" style="margin-top:14px" href={selected.url} target="_blank" rel="noopener">Buka URL ↗</a>
  {/if}
</Drawer>