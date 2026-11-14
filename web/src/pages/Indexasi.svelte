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

  const parts = $derived([
    { label: 'Indexed', value: labels.indexed || 0, color: 'var(--ok)' },
    { label: 'Not indexed', value: labels.not_indexed || 0, color: 'var(--bad)' },
    { label: 'Not discovered', value: labels.not_discovered || 0, color: 'var(--warn)' },
    { label: 'Blocked', value: labels.blocked || 0, color: 'var(--plum)' },
    { label: 'Unknown', value: labels.unknown || 0, color: 'var(--ink-4)' },
  ]);
  const toneOf = (l) => ({ indexed: 'ok', not_indexed: 'bad', not_discovered: 'warn', blocked: 'clay' }[l] || 'info');
  const cols = [
    { key: 'slug', label: 'Slug', sortable: true, get: (r) => r.slug },
    { key: 'label', label: 'Label', chip: (r) => ({ value: r.label, label: r.label.replace(/_/g, ' '), kind: toneOf(r.label) }) },
    { key: 'verdict', label: 'Verdict', get: (r) => r.verdict || '—' },
    { key: 'coverageState', label: 'Coverage', get: (r) => r.coverageState || '—' },
    { key: 'lastCrawlTime', label: 'Crawl', sortable: true, get: (r) => (r.lastCrawlTime ? date(r.lastCrawlTime) : '—') },
  ];
  function inspect() {
    ui.ask({ title: 'Inspeksi GSC semua URL?', body: 'Menjalankan seo/gsc-inspect.mjs --all. Butuh kredensial GSC terpasang; tanpa itu langkah ini akan skip jujur.', action: '/api/inspect', label: 'Mulai inspeksi' });
  }
</script>

<PageHead title="Indexasi" sub="Status indeks Google Search Console untuk URL tayang">
  <button class="btn gold sm" onclick={inspect} disabled={data.busy === '/api/inspect'}><Icon name="refresh" size={15} /> Inspeksi GSC</button>
</PageHead>

<div class="grid g4">
  <Kpi i={0} label="Index rate" value={s.indexRate == null ? 'belum diukur' : pct(s.indexRate, 1)} tone={s.indexRate == null ? '' : 'info'} note="indexed / (indexed+not+blocked)" />
  <Kpi i={1} label="Terukur inspeksi" value={s.measured ?? 0} tone="teal" />
  <Kpi i={2} label="Discovery gap" value={s.discoveryGap ?? 0} tone={(s.discoveryGap ?? 0) ? 'warn' : 'ok'} note="belum terdiscovery Google" />
  <Kpi i={3} label="Inspeksi terakhir" value={s.lastInspect ? ago(s.lastInspect) : '—'} note={s.lastInspect ? date(s.lastInspect) : 'belum pernah'} />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Index rate" sub="{num(s.total)} URL tercatat">
    <div class="idx-row">
      <Donut value={s.indexRate} label="indexed" color="var(--ok)" />
      <div class="idx-note">
        {#if s.indexRate == null}
          <div class="callout info">Belum ada inspeksi GSC. Angka indeks tidak dikarang — jalankan inspeksi dengan kredensial terpasang.</div>
        {:else}
          <p class="note">{num(labels.indexed)} terindeks dari {num(s.measured)} URL yang benar-benar terukur. {num(s.discoveryGap)} URL belum terdiscovery.</p>
        {/if}
      </div>
    </div>
  </Card>
  <Card i={5} title="Distribusi label" sub="hasil inspeksi terakhir"><StackedBar parts={parts} /></Card>
</div>

<h2 class="sec">Detail inspeksi URL</h2>
{#if rows.length}
  <DataTable columns={cols} rows={rows} searchKeys={['slug', 'verdict', 'coverageState', 'label']} placeholder="Cari slug / verdict / coverage…" />
{:else}
  <div class="callout info">Belum ada hasil inspeksi tersimpan. Setelah <code>gsc-inspect</code> berjalan dengan kredensial GSC, verdict & coverage state tiap URL muncul di sini.</div>
{/if}

<style>
  .idx-row { display: flex; gap: 18px; align-items: center; }
  .idx-note { flex: 1; min-width: 0; }
</style>