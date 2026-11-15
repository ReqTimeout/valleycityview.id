<script>
  import { data, router } from '../lib/state.svelte.js';
  import { num, pct, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import BarChart from '../components/BarChart.svelte';
  import Icon from '../components/Icon.svelte';
  import Workflow from '../components/Workflow.svelte';

  const d = $derived(data.snapshot);
  const s = $derived(d?.summary || {});
  const labels = $derived(s.labels || {});
  const rateStr = $derived(s.indexRate == null ? 'belum diukur' : pct(s.indexRate, 1));
  const contentParts = $derived([
    { label: 'Tayang', value: d?.counts?.live || 0, color: 'var(--ok)' },
    { label: 'Draf', value: d?.counts?.drafts || 0, color: 'var(--warn)' },
    { label: 'Alamat lama (dialihkan)', value: d?.counts?.redirects || 0, color: 'var(--clay)' },
  ]);
  const labelParts = $derived([
    { label: 'Masuk pencarian', value: labels.indexed || 0, color: 'var(--ok)' },
    { label: 'Belum masuk', value: labels.not_indexed || 0, color: 'var(--bad)' },
    { label: 'Belum ditemukan', value: labels.not_discovered || 0, color: 'var(--warn)' },
    { label: 'Diblokir', value: labels.blocked || 0, color: 'var(--plum)' },
    { label: 'Belum diperiksa', value: labels.unknown || 0, color: 'var(--ink-4)' },
  ]);
  const funnelColors = { 'Keyword disetujui': 'var(--gold)', 'Antrean (pending)': 'var(--warn)', 'Draft siap': 'var(--sky)', 'URL tayang': 'var(--ok)', 'Terindeks (terukur)': 'var(--teal)' };
  const funnel = $derived((d?.tracking?.funnel || []).filter((f) => f.value != null).map((f) => ({ label: f.stage, value: f.value, color: funnelColors[f.stage] || 'var(--teal)' })));
  const alerts = $derived(s.alerts || []);
  const recent = $derived((d?.recent || []).slice(0, 6));
</script>

<PageHead title="Beranda" sub="Keadaan SEO {d?.site || 'valleycityview.id'} saat ini">
  <button class="btn ghost sm" onclick={() => data.refresh()} disabled={data.loading}><Icon name="refresh" size={15} cls={data.loading ? 'spin' : ''} /> Segarkan</button>
  <button class="btn gold sm" onclick={() => router.go('/runs')}><Icon name="play" size={15} /> Kerjakan sekarang</button>
</PageHead>

<div class="grid g4">
  <Kpi i={0} label="Artikel tayang" value={d?.counts?.live ?? 0} note="{num(d?.counts?.files)} artikel di situs" tone="ok" />
  <Kpi i={1} label="Alamat tayang" value={s.total ?? 0} note="{num(s.measured)} sudah diperiksa Google" tone="teal" />
  <Kpi i={2} label="Masuk pencarian" value={rateStr} note={s.indexRate == null ? 'menunggu pemeriksaan Google' : `${num(labels.indexed)} dari ${num(s.measured)} alamat`} tone={s.indexRate == null ? '' : 'info'} />
  <Kpi i={3} label="Kata kunci siap dikerjakan" value={d?.keywords?.unused ?? 0} note="{num(d?.keywords?.approved)} sudah disetujui" tone="" />
</div>

<div style="margin-top:14px">
  <Card i={4} title="Progres kerja otomatis" sub="urutan pekerjaan mesin — semua angka nyata, tanpa data palsu">
    <Workflow snapshot={d} />
  </Card>
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={5} title="Komposisi konten" sub="{num(d?.counts?.files)} artikel">
    <StackedBar parts={contentParts} />
  </Card>
  <Card i={6} title="Hasil pemeriksaan Google" sub="{num(s.total)} alamat">
    <StackedBar parts={labelParts} />
  </Card>
</div>

{#if funnel.length}
  <h2 class="sec">Dari kata kunci sampai muncul di Google</h2>
  <Card i={7}>
    <BarChart items={funnel} />
    <p class="note">Tahap yang belum pernah terjadi tidak ditampilkan.</p>
  </Card>
{/if}

<div class="grid g2" style="margin-top:14px">
  <Card i={8} title="Baru diperbarui" sub="30 hari terakhir">
    {#if recent.length}
      <div class="recent">
        {#each recent as p (p.slug)}
          <button class="recent-row" onclick={() => router.go('/content')}>
            <Icon name="file" size={16} />
            <span class="rt">{p.title || p.slug}</span>
            <span class="rd">{ago(p.updated)}</span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="note">Belum ada pembaruan artikel dalam 30 hari terakhir.</p>
    {/if}
  </Card>
  <Card i={9} title="Perlu perhatian" sub="{alerts.length} catatan">
    {#if alerts.length}
      {#each alerts as a, i}
        <div class="callout {i === 0 ? 'bad' : ''}">{typeof a === 'string' ? a : (a.message || JSON.stringify(a))}</div>
      {/each}
    {:else}
      <div class="callout ok">Semua berjalan normal.</div>
    {/if}
    <p class="note">Kuota tayang: <b>{num(s.dailyCount)}</b> artikel per hari — disetel otomatis, bukan manual.</p>
  </Card>
</div>

<style>
  .recent { display: flex; flex-direction: column; gap: 2px; }
  .recent-row { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border: none; background: none; border-radius: 9px; cursor: pointer; text-align: left; color: var(--ink-2); transition: background .15s; width: 100%; }
  .recent-row:hover { background: var(--surface-2); }
  .recent-row :global(.ic) { color: var(--gold); }
  .rt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .rd { color: var(--ink-4); font-size: 11.5px; flex: none; }
</style>
