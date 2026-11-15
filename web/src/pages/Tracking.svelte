<script>
  import { data } from '../lib/state.svelte.js';
  import { num } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import BarChart from '../components/BarChart.svelte';
  import Donut from '../components/Donut.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Drawer from '../components/Drawer.svelte';
  import Chip from '../components/Chip.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const d = $derived(data.snapshot);
  const t = $derived(d?.tracking || {});
  const articles = $derived(t.articles || []);
  const graph = $derived(t.graph || {});
  const buckets = $derived(t.buckets || {});
  let selected = $state(null);

  const bucketItems = $derived([
    { label: 'Kuat (≥80)', value: buckets.tinggi || 0 },
    { label: 'Sedang (55–79)', value: buckets.sedang || 0 },
    { label: 'Lemah (<55)', value: buckets.rendah || 0 },
  ]);
  const scoreTone = (s) => (s >= 80 ? 'ok' : s >= 55 ? 'warn' : 'bad');
  const cols = [
    { key: 'title', label: 'Artikel', sortable: true, get: (r) => r.title || r.slug },
    { key: 'words', label: 'Kata', align: 'r', sortable: true, get: (r) => num(r.words) },
    { key: 'h2', label: 'Sub-judul', align: 'r', sortable: true, get: (r) => num(r.h2) },
    { key: 'faq', label: 'Tanya-jawab', align: 'r', sortable: true, get: (r) => num(r.faq) },
    { key: 'score', label: 'Nilai', align: 'r', sortable: true, chip: (r) => ({ value: String(r.score), label: String(r.score), kind: scoreTone(r.score) }) },
  ];
</script>

<PageHead title="Kualitas" sub="Kekuatan tiap artikel dan keterhubungan antar artikel" />

{#if t.error}
  <div class="callout bad">Gagal menghitung kualitas: {t.error}</div>
{:else if !articles.length}
  <EmptyState icon="chart" title="Belum ada artikel tayang" note="Halaman ini terisi setelah ada artikel yang benar-benar tayang." />
{:else}
  <div class="grid g4">
    <Kpi i={0} label="Nilai rata-rata" value={t.avgScore ?? 0} note="dari 100" tone={scoreTone(t.avgScore)} />
    <Kpi i={1} label="Artikel dipantau" value={t.total ?? articles.length} tone="teal" />
    <Kpi i={2} label="Artikel masih pendek (<900 kata)" value={(t.thin || []).length} tone={(t.thin || []).length ? 'warn' : 'ok'} />
    <Kpi i={3} label="Artikel belum terhubung" value={(graph.orphans || []).length} tone={(graph.orphans || []).length ? 'warn' : 'ok'} />
  </div>

  <div class="grid g2" style="margin-top:14px">
    <Card i={4} title="Sebaran nilai" sub="{num(articles.length)} artikel">
      <div class="donut-row"><Donut value={(t.avgScore ?? 0) / 100} label="rata-rata" color="var(--gold)" /><div class="bc"><BarChart items={bucketItems} /></div></div>
    </Card>
    <Card i={5} title="Keterhubungan antar artikel" sub="tautan dari satu artikel ke artikel lain">
      <dl class="kv">
        <dt>Total tautan antar artikel</dt><dd>{num(graph.edges)}</dd>
        <dt>Rata-rata tautan keluar</dt><dd>{num(graph.avgOut)}</dd>
        <dt>Artikel belum terhubung</dt><dd>{num((graph.orphans || []).length)}</dd>
      </dl>
      {#if (graph.orphans || []).length}
        <div class="callout warn" style="margin-top:10px">{(graph.orphans || []).length} artikel belum menerima tautan dari artikel lain — tanpa itu pembaca dan Google sulit menemukannya.</div>
      {:else}
        <div class="callout ok" style="margin-top:10px">Semua artikel terhubung dengan artikel lain.</div>
      {/if}
    </Card>
  </div>

  {#if (t.thin || []).length}
    <h2 class="sec">Artikel yang masih pendek</h2>
    <Card i={6}>
      <div class="thin-list">
        {#each t.thin as a (a.slug)}
          <button class="thin-row" onclick={() => (selected = articles.find((x) => x.slug === a.slug) || a)}>
            <span class="rt">{a.title || a.slug}</span>
            <Chip value={String(a.words)} label="{num(a.words)} kata" kind="warn" />
            <Chip value={String(a.score)} label="nilai {a.score}" kind={scoreTone(a.score)} />
          </button>
        {/each}
      </div>
    </Card>
  {/if}

  <h2 class="sec">Semua artikel</h2>
  <DataTable columns={cols} rows={articles} searchKeys={['title', 'slug']} placeholder="Cari artikel…" onRowClick={(r) => (selected = r)} />
{/if}

<Drawer open={!!selected} title={selected?.title || selected?.slug || ''} sub={selected?.slug || ''} onClose={() => (selected = null)}>
  {#if selected}
    <dl class="kv">
      <dt>Nilai</dt><dd><Chip value={String(selected.score)} label="{selected.score} / 100" kind={scoreTone(selected.score)} /></dd>
      <dt>Jumlah kata</dt><dd>{num(selected.words)}</dd>
      <dt>Sub-judul</dt><dd>{num(selected.h2)}</dd>
      <dt>Tanya-jawab</dt><dd>{num(selected.faq)}</dd>
      <dt>Gambar</dt><dd>{selected.image ? 'Ada' : 'Tidak'}</dd>
      <dt>Tautan ke artikel lain</dt><dd>{num((selected.related || []).length)}</dd>
      <dt>Tautan ke halaman penting</dt><dd>{selected.money ? 'Ada' : 'Tidak'}</dd>
      <dt>Tautan keluar</dt><dd>{num((selected.outLinks || []).length)}</dd>
    </dl>
    {#if selected.desc}<h2 class="sec">Ringkasan untuk Google</h2><p class="note" style="margin-top:0">{selected.desc}</p>{/if}
  {/if}
</Drawer>

<style>
  .donut-row { display: flex; gap: 18px; align-items: center; }
  .donut-row .bc { flex: 1; min-width: 0; }
  .thin-list { display: flex; flex-direction: column; gap: 2px; }
  .thin-row { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border: none; background: none; border-radius: 9px; cursor: pointer; text-align: left; width: 100%; transition: background .15s; }
  .thin-row:hover { background: var(--surface-2); }
  .thin-row .rt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--ink-2); }
</style>