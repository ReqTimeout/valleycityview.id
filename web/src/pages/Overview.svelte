<script>
  import { data, router } from '../lib/state.svelte.js';
  import { num, pct, ago, date } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import BarChart from '../components/BarChart.svelte';
  import Chip from '../components/Chip.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const s = $derived(d?.summary || {});
  const labels = $derived(s.labels || {});
  const rateStr = $derived(s.indexRate == null ? 'belum diukur' : pct(s.indexRate, 1));
  const contentParts = $derived([
    { label: 'Tayang', value: d?.counts?.live || 0, color: 'var(--ok)' },
    { label: 'Draft/review', value: d?.counts?.drafts || 0, color: 'var(--warn)' },
    { label: 'Redirect', value: d?.counts?.redirects || 0, color: 'var(--clay)' },
  ]);
  const labelParts = $derived([
    { label: 'Indexed', value: labels.indexed || 0, color: 'var(--ok)' },
    { label: 'Not indexed', value: labels.not_indexed || 0, color: 'var(--bad)' },
    { label: 'Not discovered', value: labels.not_discovered || 0, color: 'var(--warn)' },
    { label: 'Blocked', value: labels.blocked || 0, color: 'var(--plum)' },
    { label: 'Unknown', value: labels.unknown || 0, color: 'var(--ink-4)' },
  ]);
  const funnelColors = { 'Keyword disetujui': 'var(--gold)', 'Antrean (pending)': 'var(--warn)', 'Draft siap': 'var(--sky)', 'URL tayang': 'var(--ok)', 'Terindeks (terukur)': 'var(--teal)' };
  const funnel = $derived((d?.tracking?.funnel || []).filter((f) => f.value != null).map((f) => ({ label: f.stage, value: f.value, color: funnelColors[f.stage] || 'var(--teal)' })));
  const alerts = $derived(s.alerts || []);
  const recent = $derived((d?.recent || []).slice(0, 6));
</script>

<PageHead title="Overview" sub="Keadaan mesin SEO {d?.site || 'valleycityview.id'} saat ini">
  <button class="btn ghost sm" onclick={() => data.refresh()} disabled={data.loading}><Icon name="refresh" size={15} cls={data.loading ? 'spin' : ''} /> Segarkan</button>
  <button class="btn gold sm" onclick={() => router.go('/runs')}><Icon name="play" size={15} /> Jalankan pipeline</button>
</PageHead>

<div class="grid g4">
  <Kpi i={0} label="Konten tayang" value={d?.counts?.live ?? 0} note="{num(d?.counts?.files)} berkas collection" tone="ok" />
  <Kpi i={1} label="URL tercatat" value={s.total ?? 0} note="{num(s.measured)} terukur inspeksi" tone="teal" />
  <Kpi i={2} label="Index rate" value={rateStr} note={s.indexRate == null ? 'belum ada inspeksi GSC' : `${num(labels.indexed)} dari ${num(s.measured)} terukur`} tone={s.indexRate == null ? '' : 'info'} />
  <Kpi i={3} label="Keyword siap pakai" value={d?.keywords?.unused ?? 0} note="{num(d?.keywords?.approved)} disetujui total" tone="" />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Komposisi konten" sub="{num(d?.counts?.files)} berkas">
    <StackedBar parts={contentParts} />
  </Card>
  <Card i={5} title="Label indeks URL" sub="{num(s.total)} URL · {num(s.discoveryGap)} belum terdiscovery">
    <StackedBar parts={labelParts} />
  </Card>
</div>

{#if funnel.length}
  <h2 class="sec">Funnel produksi</h2>
  <Card i={6}>
    <BarChart items={funnel} />
    <p class="note">Nilai null (belum pernah terjadi) tidak digambar sebagai nol.</p>
  </Card>
{/if}

<div class="grid g2" style="margin-top:14px">
  <Card i={7} title="Baru diperbarui" sub="30 hari terakhir">
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
      <p class="note">Belum ada pembaruan konten dalam 30 hari terakhir.</p>
    {/if}
  </Card>
  <Card i={8} title="Alert mesin" sub="{alerts.length} aktif">
    {#if alerts.length}
      {#each alerts as a, i}
        <div class="callout {i === 0 ? 'bad' : ''}">{typeof a === 'string' ? a : (a.message || JSON.stringify(a))}</div>
      {/each}
    {:else}
      <div class="callout ok">Tidak ada alert mesin. Ramp gate dan remedy dalam keadaan normal.</div>
    {/if}
    <p class="note">Kuota publish harian: <b>{num(s.dailyCount)}</b> artikel/hari (ditulis ramp-gate, bukan manual).</p>
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