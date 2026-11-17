<script>
  import { data, ui } from '../lib/state.svelte.js';
  import { num, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Drawer from '../components/Drawer.svelte';
  import Chip from '../components/Chip.svelte';
  import Icon from '../components/Icon.svelte';
  import Sparkline from '../components/Sparkline.svelte';

  const d = $derived(data.snapshot);
  const kw = $derived(d?.keywords || {});
  const items = $derived(kw.items || []);
  // Peta status pipeline per slug (dari antrean) — sumber chip "Tahap".
  const bySlug = $derived(new Map((d?.queue?.items || []).map((q) => [q.slug, q])));
  let cat = $state('all');
  let tahap = $state('all');
  let selected = $state(null);

  const TAHAP = {
    pending: { label: 'Menunggu ditulis', kind: 'warn', value: 'pending' },
    draft: { label: 'Draf siap', kind: 'info', value: 'draft' },
    published: { label: 'Tayang', kind: 'ok', value: 'published' },
    dropped: { label: 'Dibuang', kind: 'bad', value: 'dropped' },
    suggested: { label: 'Usulan', kind: 'warn', value: 'suggested' },
  };
  const tahapOf = (r) => {
    const q = bySlug.get(r.slug);
    if (q && TAHAP[q.status]) return TAHAP[q.status];
    return r.approved ? { label: 'menunggu antrean', kind: 'info', value: 'pending' } : TAHAP.suggested;
  };
  /** Bintang prioritas (keputusan yang sama dengan sbdental). */
  const tierOf = (p) => (p >= 88 ? 3 : p >= 76 ? 2 : 1);
  const tierLabel = (p) => (p >= 88 ? 'Utama' : p >= 76 ? 'Penting' : 'Cadangan');

  const categories = $derived([...new Set(items.map((i) => i.category).filter(Boolean))].sort());
  const filtered = $derived(items.filter((i) =>
    (cat === 'all' || i.category === cat) &&
    (tahap === 'all' || tahapOf(i).value === tahap)));

  const cols = [
    { key: 'keyword', label: 'Keyword', sortable: true, get: (r) => r.keyword },
    { key: 'category', label: 'Kategori', sortable: true, get: (r) => r.category || '—' },
    { key: 'priority', label: 'Prioritas', align: 'r', sortable: true, sortVal: (r) => r.priority ?? 0,
      get: (r) => `${'★'.repeat(tierOf(r.priority ?? 0))} ${num(r.priority)}`,
      title: (r) => tierLabel(r.priority ?? 0) },
    { key: 'tahap', label: 'Tahap', sortable: true, sortVal: (r) => tahapOf(r).value, chip: (r) => tahapOf(r) },
    { key: 'geo', label: 'Geo', get: (r) => r.geo || '—' },
  ];
  const queueParts = $derived([
    { label: 'Menunggu', value: d?.queue?.counts?.pending || 0, color: 'var(--gold)' },
    { label: 'Draf siap', value: d?.queue?.counts?.draft || 0, color: 'var(--sky)' },
    { label: 'Tayang', value: d?.queue?.counts?.published || 0, color: 'var(--ok)' },
    { label: 'Dibuang', value: d?.queue?.counts?.dropped || 0, color: 'var(--ink-4)' },
  ]);
  const history = $derived((d?.config?.history || []).map((h) => ({ value: h.daily_count ?? h.count ?? null })));

  // ── aksi per artikel (spawn CLI engine; gerbang tetap di CLI) ─────────────
  const selQ = $derived(selected ? bySlug.get(selected.slug) : null);
  function actTulis() {
    const slug = selected?.slug;
    ui.closeDrawer?.();
    data.run('/api/generate-one', 'Menulis artikel', { slug });
    selected = null;
  }
  function actTerbitkan() {
    ui.ask({
      title: `Terbitkan "${selected?.keyword || selected?.slug}" sekarang?`,
      body: 'Artikel diperiksa gerbang kualitas lalu diterbitkan ke situs — melewati jadwal harian. Tindakan ini mengubah halaman publik.',
      action: '/api/publish-one', body: { slug: selected?.slug }, label: 'Terbitkan',
    });
    selected = null;
  }
  function actBuang() {
    ui.ask({
      title: `Buang "${selected?.keyword || selected?.slug}" dari antrean?`,
      body: 'Item keluar dari alur produksi (bisa dipulihkan lewat tombol Pulihkan). Artikel yang sudah tayang TIDAK bisa dibuang dari sini.',
      action: '/api/status', body: { slug: selected?.slug, to: 'dropped' }, label: 'Buang',
    });
    selected = null;
  }
  function actPulihkan() {
    data.run('/api/status', 'Memulihkan', { slug: selected?.slug, to: 'pending' });
    selected = null;
  }
  async function copyUrl(u) {
    try { await navigator.clipboard.writeText(u); ui.toast('URL artikel tersalin.', 'ok'); }
    catch { ui.toast('Gagal menyalin — salin manual: ' + u, 'bad'); }
  }
</script>

<PageHead title="Antrean" sub="Daftar kata kunci dan progres pengerjaannya" />

<div class="grid g4">
  <Kpi i={0} label="Total keyword" value={kw.total ?? 0} note="{num(kw.approved)} disetujui" />
  <Kpi i={1} label="Tayang" value={d?.queue?.counts?.published ?? 0} tone="ok" />
  <Kpi i={2} label="Draf siap" value={d?.queue?.counts?.draft ?? 0} tone="info" />
  <Kpi i={3} label="Menunggu ditulis" value={d?.queue?.counts?.pending ?? 0} tone="warn" note="{num(kw.unused)} kata kunci belum terpakai" />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Status antrean" sub="{num(d?.queue?.total)} artikel"><StackedBar parts={queueParts} /></Card>
  <Card i={5} title="Kuota tayang harian" sub="disetel otomatis oleh mesin">
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
  <div class="seg" role="group" aria-label="Filter tahap">
    <button aria-pressed={tahap === 'all'} onclick={() => (tahap = 'all')}>Semua</button>
    <button aria-pressed={tahap === 'pending'} onclick={() => (tahap = 'pending')}>Menunggu</button>
    <button aria-pressed={tahap === 'draft'} onclick={() => (tahap = 'draft')}>Draf</button>
    <button aria-pressed={tahap === 'published'} onclick={() => (tahap = 'published')}>Terbit</button>
  </div>
{/snippet}
<DataTable {toolbar} columns={cols} rows={filtered} searchKeys={['keyword', 'slug', 'cluster', 'geo', 'intent']} placeholder="Cari keyword / cluster / geo…" onRowClick={(r) => (selected = r)} empty="Tidak ada keyword yang cocok dengan filter." />

<Drawer open={!!selected} title={selected?.keyword || ''} sub={selected?.slug || ''} onClose={() => (selected = null)}>
  {#if selected}
    <div class="acts">
      {#if selQ?.status === 'pending'}
        <button class="btn gold sm" onclick={actTulis} disabled={data.busy}><Icon name="file" size={14} /> Tulis artikel</button>
      {:else if selQ?.status === 'draft'}
        <button class="btn gold sm" onclick={actTerbitkan} disabled={data.busy}><Icon name="up" size={14} /> Terbitkan sekarang</button>
        <button class="btn ghost sm" onclick={actTulis} disabled={data.busy}><Icon name="refresh" size={14} /> Tulis ulang</button>
      {:else if selQ?.status === 'dropped'}
        <button class="btn gold sm" onclick={actPulihkan} disabled={data.busy}><Icon name="refresh" size={14} /> Pulihkan</button>
      {:else if selQ?.status === 'published'}
        <a class="btn gold sm" href={`${d?.site || 'https://valleycityview.id'}/blog/${selected.slug}/`} target="_blank" rel="noopener"><Icon name="up" size={14} /> Lihat artikel</a>
        <button class="btn ghost sm" onclick={() => copyUrl(`${d?.site || 'https://valleycityview.id'}/blog/${selected.slug}/`)}><Icon name="file" size={14} /> Salin URL</button>
      {/if}
      {#if selQ && (selQ.status === 'pending' || selQ.status === 'draft')}
        <button class="btn ghost sm" onclick={actBuang} disabled={data.busy}><Icon name="x" size={14} /> Buang</button>
      {/if}
      {#if !selQ}<span class="note" style="margin:0">Belum masuk antrean.</span>{/if}
    </div>

    <dl class="kv">
      <dt>Tahap</dt><dd><Chip {...tahapOf(selected)} /></dd>
      <dt>Kategori</dt><dd>{selected.category || '—'}</dd>
      <dt>Cluster</dt><dd>{selected.cluster || '—'}</dd>
      <dt>Geo</dt><dd>{selected.geo || '—'}</dd>
      <dt>Prioritas</dt><dd>{'★'.repeat(tierOf(selected.priority ?? 0))} {num(selected.priority)} · {tierLabel(selected.priority ?? 0)}</dd>
      {#if selQ?.generatedAt}<dt>Ditulis</dt><dd>{ago(selQ.generatedAt)}</dd>{/if}
      {#if selQ?.publishedAt}<dt>Tayang</dt><dd>{ago(selQ.publishedAt)}</dd>{/if}
      {#if selQ?.status === 'published'}<dt>Alamat live</dt><dd><a href={`${d?.site || 'https://valleycityview.id'}/blog/${selected.slug}/`} target="_blank" rel="noopener">{d?.site || 'https://valleycityview.id'}/blog/{selected.slug}/ ↗</a></dd>{/if}
      <dt>Sumber permintaan</dt><dd>{selected.demand_signal || '—'}</dd>
    </dl>
    <h2 class="sec">Yang dicari pembaca</h2>
    <p class="note" style="margin-top:0">{selected.intent || '—'}</p>
    {#if selected.evidence}
      <h2 class="sec">Bukti data</h2>
      <dl class="kv">
        <dt>Sumber</dt><dd>{selected.evidence.source || '—'}</dd>
        <dt>Volume</dt><dd>{num(selected.evidence.volume)}</dd>
        <dt>Skor</dt><dd>{num(selected.evidence.score)}</dd>
        <dt>Kata kunci awal</dt><dd>{selected.evidence.seed || '—'}</dd>
      </dl>
    {/if}
  {/if}
</Drawer>

<style>
  .ramp { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .ramp-v { font-size: 30px; font-weight: 700; letter-spacing: -.02em; }
  .ramp-l { color: var(--ink-3); font-size: 13px; }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
</style>
