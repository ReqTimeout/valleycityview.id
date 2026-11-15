<script>
  import { data, ui } from '../lib/state.svelte.js';
  import { num, pct, date, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import Donut from '../components/Donut.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const s = $derived(d?.summary || {});
  const labels = $derived(s.labels || {});
  const rows = $derived((d?.urlRows || []).filter((r) => r.verdict || r.coverageState || r.label !== 'unknown'));

  const humanLabel = (l) => ({ indexed: 'masuk pencarian', not_indexed: 'belum masuk', not_discovered: 'belum ditemukan', blocked: 'diblokir', unknown: 'belum diperiksa' }[l] || l.replace(/_/g, ' '));
  const parts = $derived([
    { label: 'Masuk pencarian', value: labels.indexed || 0, color: 'var(--ok)' },
    { label: 'Belum masuk', value: labels.not_indexed || 0, color: 'var(--bad)' },
    { label: 'Belum ditemukan', value: labels.not_discovered || 0, color: 'var(--warn)' },
    { label: 'Diblokir', value: labels.blocked || 0, color: 'var(--plum)' },
    { label: 'Belum diperiksa', value: labels.unknown || 0, color: 'var(--ink-4)' },
  ]);
  const toneOf = (l) => ({ indexed: 'ok', not_indexed: 'bad', not_discovered: 'warn', blocked: 'clay' }[l] || 'info');
  const cols = [
    { key: 'slug', label: 'Alamat', sortable: true, get: (r) => r.slug },
    { key: 'label', label: 'Status', chip: (r) => ({ value: r.label, label: humanLabel(r.label), kind: toneOf(r.label) }) },
    { key: 'verdict', label: 'Kesimpulan Google', get: (r) => r.verdict || '—' },
    { key: 'coverageState', label: 'Keterangan', get: (r) => r.coverageState || '—' },
    { key: 'lastCrawlTime', label: 'Dikunjungi', sortable: true, get: (r) => (r.lastCrawlTime ? date(r.lastCrawlTime) : '—') },
  ];
  function inspect() {
    ui.ask({ title: 'Periksa semua alamat di Google?', body: 'Mengirim permintaan pemeriksaan status untuk setiap alamat tayang. Butuh koneksi Google terpasang; tanpa itu pemeriksaan dilewati dan dilaporkan jujur.', action: '/api/inspect', label: 'Mulai pemeriksaan' });
  }
</script>

<PageHead title="Status Google" sub="Hasil pemeriksaan Google untuk setiap alamat tayang">
  <button class="btn gold sm" onclick={inspect} disabled={data.busy === '/api/inspect'}><Icon name="refresh" size={15} /> Periksa semua di Google</button>
</PageHead>

<div class="grid g4">
  <Kpi i={0} label="Masuk pencarian" value={s.indexRate == null ? 'belum diukur' : pct(s.indexRate, 1)} tone={s.indexRate == null ? '' : 'info'} note="dari alamat yang sudah diperiksa" />
  <Kpi i={1} label="Sudah diperiksa" value={s.measured ?? 0} tone="teal" />
  <Kpi i={2} label="Belum ditemukan" value={s.discoveryGap ?? 0} tone={(s.discoveryGap ?? 0) ? 'warn' : 'ok'} note="Google belum mengetahui alamatnya" />
  <Kpi i={3} label="Pemeriksaan terakhir" value={s.lastInspect ? ago(s.lastInspect) : '—'} note={s.lastInspect ? date(s.lastInspect) : 'belum pernah'} />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Masuk pencarian" sub="{num(s.total)} alamat tayang">
    <div class="idx-row">
      <Donut value={s.indexRate} label="masuk" color="var(--ok)" />
      <div class="idx-note">
        {#if s.indexRate == null}
          <div class="callout info">Belum ada pemeriksaan Google, jadi angkanya belum bisa dihitung — tidak dikarang. Pemeriksaan berjalan otomatis tiap pagi, atau tekan tombol di atas.</div>
        {:else}
          <p class="note">{num(labels.indexed)} alamat masuk pencarian dari {num(s.measured)} yang sudah diperiksa. {num(s.discoveryGap)} alamat belum ditemukan Google.</p>
        {/if}
      </div>
    </div>
  </Card>
  <Card i={5} title="Rincian status" sub="hasil pemeriksaan terakhir"><StackedBar parts={parts} /></Card>
</div>

<h2 class="sec">Detail pemeriksaan</h2>
{#if rows.length}
  <DataTable columns={cols} rows={rows} searchKeys={['slug', 'verdict', 'coverageState', 'label']} placeholder="Cari alamat / keterangan…" />
{:else}
  <div class="callout info">Belum ada hasil pemeriksaan tersimpan. Setelah pemeriksaan berjalan dengan koneksi Google terpasang, hasilnya untuk tiap alamat muncul di sini.</div>
{/if}

<style>
  .idx-row { display: flex; gap: 18px; align-items: center; }
  .idx-note { flex: 1; min-width: 0; }
</style>
