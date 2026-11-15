<script>
  import { data, router } from '../lib/state.svelte.js';
  import { num, pct, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import StackedBar from '../components/StackedBar.svelte';
  import BarChart from '../components/BarChart.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Donut from '../components/Donut.svelte';
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
  const funnelColors = { 'Kata kunci disetujui': 'var(--gold)', 'Menunggu dibuat': 'var(--warn)', 'Draf siap': 'var(--sky)', 'Artikel tayang': 'var(--ok)', 'Masuk pencarian': 'var(--teal)' };
  const funnel = $derived((d?.tracking?.funnel || []).filter((f) => f.value != null).map((f) => ({ label: f.stage, value: f.value, color: funnelColors[f.stage] || 'var(--teal)' })));
  const alerts = $derived(s.alerts || []);
  const recent = $derived((d?.recent || []).slice(0, 6));

  // ── produksi hari ini + sparkline 14 hari ─────────────────────────────────
  const pr = $derived(d?.produksi || {});
  const createdSpark = $derived((pr.createdSeries || []).map((x) => x.n));
  const publishedSpark = $derived((pr.publishedSeries || []).map((x) => x.n));

  // ── jadwal tayang (hitung mundur reaktif) ─────────────────────────────────
  const sched = $derived(d?.schedule || {});
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30000);
    return () => clearInterval(t);
  });
  const untilText = $derived.by(() => {
    now;
    if (!sched.nextAt) return null;
    const ms = Date.parse(sched.nextAt) - now;
    if (ms <= 0) return 'segera (menunggu tik jalan)';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} menit lagi`;
    return `${Math.floor(m / 60)} jam ${m % 60} menit lagi`;
  });
  const windowHours = $derived.by(() => {
    const { startHour, endHour, nowHour } = sched;
    if (startHour == null || endHour == null || nowHour == null) return [];
    const out = [];
    for (let h = startHour; h < endHour; h++) out.push({ h, passed: h < nowHour, current: h === nowHour });
    return out;
  });

  // ── tren Google (30 hari, ditulis harian oleh seo/gsc-history.mjs) ────────
  const hist = $derived(d?.gsc?.history || []);
  const histLabels = $derived(hist.map((x) => x.date));
  const agg = $derived(d?.gsc?.agg || null);

  // ── alur antrean (donut multi-status) ─────────────────────────────────────
  const pipeSegs = $derived.by(() => {
    const c = d?.queue?.counts || {};
    const map = [
      ['pending', 'Menunggu ditulis', 'var(--gold)'],
      ['draft', 'Draf siap', 'var(--sky)'],
      ['published', 'Tayang', 'var(--ok)'],
      ['dropped', 'Dibuang', 'var(--ink-4)'],
    ];
    return map.filter(([k]) => (c[k] || 0) > 0).map(([k, label, color]) => ({ label, value: c[k], color }));
  });

  // ── kesehatan situs (diperiksa langsung harian) ───────────────────────────
  const checkNames = { robots: 'Robots.txt', sitemap: 'Peta situs', llms: 'llms.txt', indexnow: 'Kunci IndexNow', beranda: 'Beranda' };
  const checkRows = $derived.by(() => {
    const c = d?.checks;
    if (!c) return null;
    return Object.entries(c)
      .filter(([k]) => checkNames[k])
      .map(([k, v]) => ({ key: k, name: checkNames[k], status: v.status, detail: v.detail }));
  });
</script>

<PageHead title="Beranda" sub="Keadaan SEO {d?.site || 'valleycityview.id'} saat ini">
  <button class="btn ghost sm" onclick={() => data.refresh()} disabled={data.loading}><Icon name="refresh" size={15} cls={data.loading ? 'spin' : ''} /> Segarkan</button>
  <button class="btn gold sm" onclick={() => router.go('/runs')}><Icon name="play" size={15} /> Kerjakan sekarang</button>
</PageHead>

<div class="grid g4">
  <Kpi i={0} label="Dibuat hari ini" value={pr.createdToday ?? 0} note="draf baru dari mesin penulis" tone="ok" spark={createdSpark} sparkColor="var(--gold)" />
  <Kpi i={1} label="Terbit hari ini" value={pr.publishedToday ?? 0} note={sched.dailyCount != null ? `kuota ${sched.dailyCount}/hari` : 'kuota belum diatur'} tone="teal" spark={publishedSpark} sparkColor="var(--teal)" />
  <Kpi i={2} label="Siap tayang" value={sched.drafts ?? 0} note="{num(d?.queue?.counts?.pending)} menunggu ditulis" tone="" />
  <Kpi i={3} label="Masuk pencarian" value={rateStr} note={s.indexRate == null ? 'menunggu pemeriksaan Google' : `${num(labels.indexed)} dari ${num(s.measured)} alamat`} tone={s.indexRate == null ? '' : 'info'} />
</div>

<div style="margin-top:14px">
  <Card i={4} title="Jadwal tayang hari ini" sub={sched.halt ? 'dihentikan manual' : 'jendela kerja mesin publikasi'}>
    <div class="jadwal">
      <div class="jadwal-main">
        <div class="jd-item">
          <span class="jl">Tayang berikutnya</span>
          <b class="jv">{untilText ?? (sched.nextReason || '—')}</b>
          {#if untilText && sched.nextAt}<span class="jn">{new Date(sched.nextAt).toTimeString().slice(0, 5)} WIB · {sched.nextReason || ''}</span>{/if}
          {#if !untilText && sched.nextReason}<span class="jn">{sched.nextReason}</span>{/if}
        </div>
        <div class="jd-item">
          <span class="jl">Kuota hari ini</span>
          <b class="jv">{num(sched.publishedToday ?? 0)} / {sched.dailyCount ?? '—'}</b>
          <span class="jn">{sched.quotaLeft != null && sched.quotaLeft > 0 ? `${sched.quotaLeft} slot tersisa` : (sched.dailyCount != null ? 'kuota terpenuhi' : 'kuota belum diatur')}</span>
        </div>
        <div class="jd-item">
          <span class="jl">Jendela kerja</span>
          <b class="jv">{sched.startHour != null ? `${sched.startHour}:00–${sched.endHour}:00 WIB` : '—'}</b>
          <span class="jn">{sched.inWindow ? 'sedang di dalam jendela' : 'di luar jendela'}</span>
        </div>
      </div>
      {#if windowHours.length}
        <div class="rail" aria-label="jam berjalan hari ini">
          {#each windowHours as w}
            <div class="slot {w.current ? 'now' : w.passed ? 'done' : ''}">
              <span class="sh">{String(w.h).padStart(2, '0')}</span>
              <span class="sd">{w.current ? '●' : w.passed ? '✓' : ''}</span>
            </div>
          {/each}
        </div>
        <p class="note">Satu artikel diterbitkan per jam selama jendela terbuka — dilanjutkan otomatis sampai kuota harian tercapai.</p>
      {/if}
    </div>
  </Card>
</div>

<div style="margin-top:14px">
  <Card i={5} title="Progres kerja otomatis" sub="urutan pekerjaan mesin — semua angka nyata, tanpa data palsu">
    <Workflow snapshot={d} />
  </Card>
</div>

<h2 class="sec">Tren pencarian Google</h2>
<div class="grid g2">
  <Card i={6} title="Klik & tayangan" sub={agg ? `periode ${agg.period?.start} → ${agg.period?.end}` : (d?.gsc?.historyNote || '30 hari terakhir')}>
    {#if hist.length}
      <LineChart
        labels={histLabels}
        series={[
          { key: 'clicks', label: 'Klik', color: 'var(--gold)', axis: 'left', fill: true },
          { key: 'impressions', label: 'Tayangan', color: 'var(--sky)', axis: 'right', dashed: true },
        ]}
        values={{
          clicks: hist.map((x) => x.clicks),
          impressions: hist.map((x) => x.impressions),
        }}
        formatLeft={(v) => num(Math.round(v))}
        formatRight={(v) => num(Math.round(v))}
        empty={d?.gsc?.historyNote || 'Belum ada pengukuran — diisi otomatis setiap hari.'}
      />
    {:else}
      <p class="note">{d?.gsc?.historyNote || 'Riwayat harian Google belum pernah diukur — jalankan Siklus harian untuk mengisi.'}</p>
    {/if}
  </Card>
  <Card i={7} title="Posisi rata-rata" sub="makin kecil makin dekat ke halaman pertama">
    {#if hist.length}
      <LineChart
        labels={histLabels}
        series={[{ key: 'position', label: 'Posisi', color: 'var(--teal)', fill: true }]}
        values={{ position: hist.map((x) => x.position) }}
        yReverse
        formatLeft={(v) => num(Math.round(v * 10) / 10)}
        empty="Belum ada pengukuran posisi."
      />
    {:else}
      <p class="note">Belum ada pengukuran posisi — data muncul setelah pemeriksaan Google harian berjalan.</p>
    {/if}
  </Card>
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={8} title="Alur antrean" sub="{num(d?.queue?.total)} kata kunci dalam antrean">
    {#if pipeSegs.length}
      <div class="donut-row">
        <Donut segments={pipeSegs} size={140} centerSub="antrean" />
      </div>
      <p class="note">Klik kartu Antrean untuk melihat rinciannya.</p>
    {:else}
      <p class="note">Antrean belum terbaca.</p>
    {/if}
  </Card>
  <Card i={9} title="Data Google" sub={agg ? 'gabungan periode di samping' : 'menunggu pengukuran pertama'}>
    {#if agg}
      <div class="mini-stats">
        <div><span>Klik</span><b>{num(agg.clicks)}</b></div>
        <div><span>Tayangan</span><b>{num(agg.impressions)}</b></div>
        <div><span>Rasio klik</span><b>{agg.ctr == null ? '—' : pct(agg.ctr, 2)}</b></div>
        <div><span>Posisi rata-rata</span><b>{agg.position == null ? '—' : num(agg.position)}</b></div>
      </div>
      <p class="note">Periode {agg.period?.start} → {agg.period?.end}</p>
    {:else}
      <p class="note">{d?.gsc?.historyNote || 'Pengukuran Google belum pernah berjalan — jalankan Siklus harian.'}</p>
    {/if}
  </Card>
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={10} title="Komposisi konten" sub="{num(d?.counts?.files)} artikel">
    <StackedBar parts={contentParts} />
  </Card>
  <Card i={11} title="Kesehatan situs" sub={d?.checks?._meta ? `diperiksa ${ago(d.checks._meta.checkedAt)}` : 'belum pernah diperiksa'}>
    {#if checkRows}
      <div class="chk">
        {#each checkRows as c}
          <span class="chk-chip {c.status}">
            <Icon name={c.status === 'ok' ? 'check' : c.status === 'warn' ? 'alert' : 'x'} size={13} />
            {c.name}
          </span>
        {/each}
      </div>
      <p class="note">{d.checks._meta.ok} dari {d.checks._meta.total} pemeriksaan lolos — dijalankan otomatis tiap hari.</p>
      <button class="btn ghost sm" onclick={() => router.go('/health')}><Icon name="shield" size={14} /> Detail sistem</button>
    {:else}
      <p class="note">Pemeriksaan langsung ke situs berjalan tiap hari bersama Siklus harian — hasilnya muncul di sini.</p>
    {/if}
  </Card>
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={12} title="Hasil pemeriksaan Google" sub="{num(s.total)} alamat">
    <StackedBar parts={labelParts} />
  </Card>
  <Card i={13} title="Baru diperbarui" sub="30 hari terakhir">
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
</div>

{#if funnel.length}
  <h2 class="sec">Dari kata kunci sampai muncul di Google</h2>
  <Card i={14}>
    <BarChart items={funnel} />
    <p class="note">Tahap yang belum pernah terjadi tidak ditampilkan.</p>
  </Card>
{/if}

<Card i={15} title="Perlu perhatian" sub="{alerts.length} catatan" >
  {#if alerts.length}
    {#each alerts as a, i}
      <div class="callout {i === 0 ? 'bad' : ''}">{typeof a === 'string' ? a : (a.message || JSON.stringify(a))}</div>
    {/each}
  {:else}
    <div class="callout ok">Semua berjalan normal.</div>
  {/if}
  <p class="note">Kuota tayang: <b>{num(s.dailyCount)}</b> artikel per hari — disetel otomatis oleh mesin, bukan manual.</p>
</Card>

<style>
  .recent { display: flex; flex-direction: column; gap: 2px; }
  .recent-row { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border: none; background: none; border-radius: 9px; cursor: pointer; text-align: left; color: var(--ink-2); transition: background .15s; width: 100%; }
  .recent-row:hover { background: var(--surface-2); }
  .recent-row :global(.ic) { color: var(--gold); }
  .rt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .rd { color: var(--ink-4); font-size: 11.5px; flex: none; }

  .jadwal { display: flex; flex-direction: column; gap: 14px; }
  .jadwal-main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .jd-item { display: flex; flex-direction: column; gap: 3px; }
  .jl { font-size: 11.5px; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; }
  .jv { font-size: 17px; font-weight: 700; color: var(--ink); }
  .jn { font-size: 12px; color: var(--ink-4); }
  .rail { display: flex; gap: 6px; flex-wrap: wrap; }
  .slot { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; padding: 6px 4px 5px; border-radius: 8px; background: var(--surface-3); border: 1px solid var(--line); }
  .slot .sh { font-size: 12px; font-weight: 700; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .slot .sd { font-size: 10px; height: 12px; color: var(--ink-4); }
  .slot.done { background: var(--ok-soft); border-color: transparent; }
  .slot.done .sh, .slot.done .sd { color: var(--ok); }
  .slot.now { background: var(--gold-soft); border-color: var(--gold); }
  .slot.now .sh, .slot.now .sd { color: var(--gold); }
  .donut-row { display: flex; justify-content: center; padding: 4px 0; }
  .mini-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mini-stats div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: var(--surface-2); border-radius: 10px; border: 1px solid var(--line); }
  .mini-stats span { font-size: 11.5px; color: var(--ink-3); }
  .mini-stats b { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .chk { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .chk-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; padding: 5px 11px; border-radius: 999px; }
  .chk-chip.ok { color: var(--ok); background: var(--ok-soft); }
  .chk-chip.warn { color: var(--warn); background: var(--warn-soft); }
  .chk-chip.fail { color: var(--bad); background: var(--bad-soft); }
  @media (max-width: 720px) {
    .jadwal-main { grid-template-columns: 1fr; }
  }
</style>
