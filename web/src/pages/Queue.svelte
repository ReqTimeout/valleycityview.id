<script>
  import { data } from '../lib/state.svelte.js';
  import { num, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Drawer from '../components/Drawer.svelte';
  import Chip from '../components/Chip.svelte';
  import Sparkline from '../components/Sparkline.svelte';

  const d = $derived(data.snapshot);
  const kw = $derived(d?.keywords || {});
  const items = $derived(kw.items || []);
  let cat = $state('all');
  let appr = $state('all');
  let selected = $state(null);

  const categories = $derived([...new Set(items.map((i) => i.category).filter(Boolean))].sort());
  const filtered = $derived(items.filter((i) =>
    (cat === 'all' || i.category === cat) &&
    (appr === 'all' || (appr === 'approved' ? i.approved : i.approved === false))));
  const cols = [
    { key: 'keyword', label: 'Keyword', sortable: true, get: (r) => r.keyword },
    { key: 'category', label: 'Kategori', sortable: true, get: (r) => r.category || '—' },
    { key: 'cluster', label: 'Cluster', sortable: true, get: (r) => r.cluster || '—' },
    { key: 'priority', label: 'Prioritas', align: 'r', sortable: true, get: (r) => num(r.priority) },
    { key: 'geo', label: 'Geo', get: (r) => r.geo || '—' },
    { key: 'approved', label: 'Status', chip: (r) => (r.approved ? { value: 'approved', label: 'approved', kind: 'ok' } : { value: 'suggested', label: 'suggested', kind: 'warn' }) },
  ];
  const queueParts = $derived([
    { label: 'Pending', value: d?.queue?.counts?.pending || 0, color: 'var(--warn)' },
    { label: 'Published', value: d?.queue?.counts?.published || 0, color: 'var(--ok)' },
    { label: 'Draft', value: d?.queue?.counts?.draft || 0, color: 'var(--sky)' },
  ]);
  const history = $derived((d?.config?.history || []).map((h) => ({ value: h.daily_count ?? h.count ?? null })));
</script>

<PageHead title="Antrean" sub="Keyword disetujui, kuota ramp, dan anchor area" />

<div class="grid g4">
  <Kpi i={0} label="Total keyword" value={kw.total ?? 0} />
  <Kpi i={1} label="Disetujui" value={kw.approved ?? 0} tone="ok" note="min {num(kw.minApproved)}" />
  <Kpi i={2} label="Siap pakai (unused)" value={kw.unused ?? 0} tone="teal" />
  <Kpi i={3} label="Antrean pending" value={d?.queue?.counts?.pending ?? 0} tone="info" />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Status antrean" sub="{num(d?.queue?.total)} item"><StackedBar parts={queueParts} /></Card>
  <Card i={5} title="Kuota ramp" sub="ditulis ramp-gate tiap Senin">
    <div class="ramp">
      <span class="ramp-v">{num(d?.config?.daily_count)}</span>
      <span class="ramp-l">artikel/hari</span>
      {#if d?.config?.halt}<Chip value="halt" kind="bad" label="HALT" />{:else}<Chip value="open" kind="ok" label="aktif" />{/if}
    </div>
    {#if history.length >= 2}<Sparkline points={history} color="var(--gold)" />{:else}<p class="note">Riwayat kuota belum cukup untuk tren.</p>{/if}
    <p class="note">Disetujui {ago(kw.approvedAt)} oleh {kw.approvedBy || '—'}.</p>
  </Card>
</div>

<h2 class="sec">Matriks keyword</h2>
{#snippet toolbar()}
  <select class="select" bind:value={cat} aria-label="Filter kategori">
    <option value="all">Semua kategori</option>
    {#each categories as c}<option value={c}>{c}</option>{/each}
  </select>
  <div class="seg" role="group" aria-label="Filter status">
    <button aria-pressed={appr === 'all'} onclick={() => (appr = 'all')}>Semua</button>
    <button aria-pressed={appr === 'approved'} onclick={() => (appr = 'approved')}>Approved</button>
    <button aria-pressed={appr === 'suggested'} onclick={() => (appr = 'suggested')}>Suggested</button>
  </div>
{/snippet}
<DataTable {toolbar} columns={cols} rows={filtered} searchKeys={['keyword', 'slug', 'cluster', 'geo', 'intent']} placeholder="Cari keyword / cluster / geo…" onRowClick={(r) => (selected = r)} empty="Tidak ada keyword yang cocok dengan filter." />

<Drawer open={!!selected} title={selected?.keyword || ''} sub={selected?.slug || ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Kategori</dt><dd>{selected.category || '—'}</dd>
      <dt>Cluster</dt><dd>{selected.cluster || '—'}</dd>
      <dt>Geo</dt><dd>{selected.geo || '—'}</dd>
      <dt>Prioritas</dt><dd>{num(selected.priority)}</dd>
      <dt>Sinyal</dt><dd>{selected.demand_signal || '—'}</dd>
      <dt>Status</dt><dd><Chip value={selected.approved ? 'approved' : 'suggested'} kind={selected.approved ? 'ok' : 'warn'} label={selected.approved ? 'approved' : 'suggested'} /></dd>
    </dl>
    <h2 class="sec">Intent</h2>
    <p class="note" style="margin-top:0">{selected.intent || '—'}</p>
    {#if selected.evidence}
      <h2 class="sec">Evidence</h2>
      <dl class="kv">
        <dt>Sumber</dt><dd>{selected.evidence.source || '—'}</dd>
        <dt>Volume</dt><dd>{num(selected.evidence.volume)}</dd>
        <dt>Skor</dt><dd>{num(selected.evidence.score)}</dd>
        <dt>Seed</dt><dd>{selected.evidence.seed || '—'}</dd>
      </dl>
    {/if}
  {/if}
</Drawer>

<style>
  .ramp { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .ramp-v { font-size: 30px; font-weight: 700; letter-spacing: -.02em; }
  .ramp-l { color: var(--ink-3); font-size: 13px; }
</style>