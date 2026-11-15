<script>
  import { data, ui } from '../lib/state.svelte.js';
  import { fetchDraft } from '../lib/api.js';
  import { num, date, ago } from '../lib/format.js';
  import Icon from '../components/Icon.svelte';
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
  // Pratinjau isi artikel (dari /api/draft) — dimuat saat Drawer dibuka.
  let preview = $state({ slug: null, html: null, loading: false, error: null });

  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** Konverter MDX ringkas khusus artikel hasil mesin (paragraf, ##, daftar, tabel, bold, link). */
  function mdToHtml(md) {
    const lines = String(md).split('\n');
    let html = '', inUl = false, inTable = false;
    const inline = (x) => esc(x)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const closeAll = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inTable) { html += '</table></div>'; inTable = false; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      if (/^##\s+/.test(l)) { closeAll(); html += `<h4>${inline(l.replace(/^##\s+/, ''))}</h4>`; }
      else if (/^###\s+/.test(l)) { closeAll(); html += `<h5>${inline(l.replace(/^###\s+/, ''))}</h5>`; }
      else if (/^[-*]\s+/.test(l)) { if (inTable) { html += '</table></div>'; inTable = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`; }
      else if (/^\|.*\|$/.test(l)) {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (!inTable) { html += '<div class="ptab"><table>'; inTable = true; }
        if (/^\|[\s:|-]+\|$/.test(l)) continue; // pemisah kolom
        const cells = l.split('|').slice(1, -1).map((c) => c.trim());
        html += `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`;
      }
      else if (l === '') { closeAll(); }
      else { closeAll(); html += `<p>${inline(l)}</p>`; }
    }
    closeAll();
    return html;
  }
  $effect(() => {
    const slug = selected?.slug;
    if (!slug || !selected || selected.redirectTo) { preview = { slug: null, html: null, loading: false, error: null }; return; }
    if (preview.slug === slug) return; // loading penua → boleh diganti (respons lama diabaikan oleh cek preview.slug)
    preview = { slug, html: null, loading: true, error: null };
    fetchDraft(slug)
      .then((r) => { if (preview.slug === slug) preview = { slug, html: mdToHtml(r.md || ''), loading: false, error: null }; })
      .catch((e) => { if (preview.slug === slug) preview = { slug, html: null, loading: false, error: 'Pratinjau gagal: ' + e.message }; });
  });

  const bySlug = $derived(new Map((d?.queue?.items || []).map((q) => [q.slug, q])));
  const selQ = $derived(selected ? bySlug.get(selected.slug) : null);
  function actTerbitkan() {
    ui.ask({ title: `Terbitkan "${selected?.title || selected?.slug}" sekarang?`, body: 'Artikel diperiksa gerbang kualitas lalu diterbitkan ke situs — melewati jadwal harian.', action: '/api/publish-one', body: { slug: selected?.slug }, label: 'Terbitkan' });
    selected = null;
  }
  function actTulisUlang() {
    data.run('/api/generate-one', 'Menulis ulang', { slug: selected?.slug });
    selected = null;
  }

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

<PageHead title="Konten" sub="Semua artikel blog — tayang, draf, dan alamat lama yang dialihkan" />

<div class="grid g4">
  <Kpi i={0} label="Total artikel" value={d?.counts?.files ?? 0} />
  <Kpi i={1} label="Tayang" value={d?.counts?.live ?? 0} tone="ok" />
  <Kpi i={2} label="Draf / tinjauan" value={d?.counts?.drafts ?? 0} tone="warn" />
  <Kpi i={3} label="Alamat lama" value={d?.counts?.redirects ?? 0} tone="clay" />
</div>

<div style="margin-top:14px"><Card i={4} title="Komposisi status"><StackedBar parts={parts} /></Card></div>

<h2 class="sec">Daftar konten</h2>
{#snippet toolbar()}
  <div class="seg" role="group" aria-label="Filter status konten">
    <button aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>Semua</button>
    <button aria-pressed={filter === 'live'} onclick={() => (filter = 'live')}>Tayang</button>
    <button aria-pressed={filter === 'draft'} onclick={() => (filter = 'draft')}>Draf</button>
    <button aria-pressed={filter === 'redirect'} onclick={() => (filter = 'redirect')}>Alamat lama</button>
  </div>
{/snippet}
<DataTable {toolbar} columns={cols} rows={filtered} searchKeys={['title', 'slug']} placeholder="Cari judul / slug…" onRowClick={(r) => (selected = r)} />

<Drawer open={!!selected} title={selected?.title || selected?.slug || ''} sub={selected?.slug || ''} onClose={() => (selected = null)}>
  {#if selected}
    {#if selQ?.status === 'draft'}
      <div class="acts">
        <button class="btn gold sm" onclick={actTerbitkan} disabled={data.busy}><Icon name="up" size={14} /> Terbitkan sekarang</button>
        <button class="btn ghost sm" onclick={actTulisUlang} disabled={data.busy}><Icon name="refresh" size={14} /> Tulis ulang</button>
      </div>
    {/if}
    <dl class="kv">
      <dt>Status</dt><dd><Chip value={kindOf(selected)} label={kindOf(selected)} kind={toneOf(kindOf(selected))} /></dd>
      <dt>Status di berkas</dt><dd>{selected.status || '—'}</dd>
      <dt>Tanggal</dt><dd>{date(selected.date)}</dd>
      <dt>Diperbarui</dt><dd>{selected.updated ? date(selected.updated) : '—'}</dd>
      <dt>Dialihkan ke</dt><dd>{selected.redirectTo || '—'}</dd>
      <dt>Tayang?</dt><dd>{selected.live ? 'Ya' : 'Tidak'}</dd>
    </dl>
    {#if selected.live}
      <a class="btn ghost sm" style="margin-top:14px" href="https://{d?.site}/blog/{selected.slug}" target="_blank" rel="noopener">Buka halaman publik ↗</a>
    {/if}

    <h2 class="sec">Pratinjau isi</h2>
    {#if preview.loading}
      <p class="note">Memuat isi artikel…</p>
    {:else if preview.error}
      <p class="note">{preview.error}</p>
    {:else if preview.html}
      <div class="prev">{@html preview.html}</div>
    {:else if !selected.live && !selected.redirectTo}
      <p class="note">Isi tidak tersedia untuk artikel ini.</p>
    {/if}
  {/if}
</Drawer>

<style>
  .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
  .prev { font-size: 13.5px; line-height: 1.65; color: var(--ink-2); max-height: 46vh; overflow: auto; padding-right: 6px; border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; background: var(--surface-2); }
  .prev :global(h4) { font-size: 15px; margin: 16px 0 6px; color: var(--ink); }
  .prev :global(h4:first-child) { margin-top: 0; }
  .prev :global(h5) { font-size: 13.5px; margin: 12px 0 4px; color: var(--ink-2); }
  .prev :global(p) { margin: 0 0 10px; }
  .prev :global(ul) { margin: 0 0 10px; padding-left: 20px; }
  .prev :global(li) { margin-bottom: 4px; }
  .prev :global(.ptab) { overflow-x: auto; margin: 0 0 12px; }
  .prev :global(table) { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  .prev :global(td) { border: 1px solid var(--line); padding: 6px 9px; white-space: nowrap; }
  .prev :global(tr:first-child td) { background: var(--surface-3); font-weight: 600; }
  .prev :global(a) { color: var(--info); }
</style>