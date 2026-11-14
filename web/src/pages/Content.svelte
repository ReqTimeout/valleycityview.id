<script>
  import { data } from '../lib/state.svelte.js';
  import { num, date, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Drawer from '../components/Drawer.svelte';
  import Chip from '../components/Chip.svelte';

  const d = $derived(data.snapshot);
  const posts = $derived(d?.posts || []);
  let filter = $state('all');
  let selected = $state(null);

  const kindOf = (p) => (p.redirectTo ? 'redirect' : p.live ? 'tayang' : p.status === 'review' ? 'review' : 'draft');
  const toneOf = (k) => ({ tayang: 'ok', draft: 'warn', review: 'info', redirect: 'clay' }[k] || 'info');
  const filtered = $derived(posts.filter((p) => {
    const k = kindOf(p);
    return filter === 'all' || (filter === 'live' ? k === 'tayang' : filter === 'redirect' ? k === 'redirect' : k === 'draft' || k === 'review');
  }));
  const parts = $derived([
    { label: 'Tayang', value: d?.counts?.live || 0, color: 'var(--ok)' },
    { label: 'Draft/review', value: d?.counts?.drafts || 0, color: 'var(--warn)' },
    { label: 'Redirect', value: d?.counts?.redirects || 0, color: 'var(--clay)' },
  ]);
  const cols = [
    { key: 'title', label: 'Judul', sortable: true, get: (r) => r.title || r.slug },
    { key: 'slug', label: 'Slug', sortable: true, get: (r) => r.slug },
    { key: 'status', label: 'Status', chip: (r) => { const k = kindOf(r); return { value: k, label: k, kind: toneOf(k) }; } },
    { key: 'date', label: 'Tanggal', sortable: true, get: (r) => date(r.date) },
    { key: 'updated', label: 'Diperbarui', sortable: true, get: (r) => (r.updated ? ago(r.updated) : '—') },
  ];
</script>

<PageHead title="Konten" sub="Seluruh berkas collection blog — tayang, draft, dan redirect" />

<div class="grid g4">
  <Kpi i={0} label="Total berkas" value={d?.counts?.files ?? 0} />
  <Kpi i={1} label="Tayang" value={d?.counts?.live ?? 0} tone="ok" />
  <Kpi i={2} label="Draft / review" value={d?.counts?.drafts ?? 0} tone="warn" />
  <Kpi i={3} label="Redirect" value={d?.counts?.redirects ?? 0} tone="clay" />
</div>

<div style="margin-top:14px"><Card i={4} title="Komposisi status"><StackedBar parts={parts} /></Card></div>

<h2 class="sec">Daftar konten</h2>
{#snippet toolbar()}
  <div class="seg" role="group" aria-label="Filter status konten">
    <button aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>Semua</button>
    <button aria-pressed={filter === 'live'} onclick={() => (filter = 'live')}>Tayang</button>
    <button aria-pressed={filter === 'draft'} onclick={() => (filter = 'draft')}>Draft</button>
    <button aria-pressed={filter === 'redirect'} onclick={() => (filter = 'redirect')}>Redirect</button>
  </div>
{/snippet}
<DataTable {toolbar} columns={cols} rows={filtered} searchKeys={['title', 'slug']} placeholder="Cari judul / slug…" onRowClick={(r) => (selected = r)} />

<Drawer open={!!selected} title={selected?.title || selected?.slug || ''} sub={selected?.slug || ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Status</dt><dd><Chip value={kindOf(selected)} label={kindOf(selected)} kind={toneOf(kindOf(selected))} /></dd>
      <dt>Frontmatter</dt><dd>{selected.status || '—'}</dd>
      <dt>Tanggal</dt><dd>{date(selected.date)}</dd>
      <dt>Diperbarui</dt><dd>{selected.updated ? date(selected.updated) : '—'}</dd>
      <dt>Redirect ke</dt><dd>{selected.redirectTo || '—'}</dd>
      <dt>Tayang?</dt><dd>{selected.live ? 'Ya' : 'Tidak'}</dd>
    </dl>
    <a class="btn ghost sm" style="margin-top:14px" href="https://{d?.site}/blog/{selected.slug}" target="_blank" rel="noopener">Buka halaman publik ↗</a>
  {/if}
</Drawer>