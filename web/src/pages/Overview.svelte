<script>
  import { data, router } from '../lib/state.svelte.js';
  import { num, pct, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import LineChart from '../components/LineChart.svelte';
  import Donut from '../components/Donut.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const s = $derived(d?.summary || {});
  const labels = $derived(s.labels || {});
  const rateStr = $derived(s.indexRate == null ? 'belum diukur' : pct(s.indexRate, 1));
  const alerts = $derived(s.alerts || []);

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

  /**
   * Baris jadwal per jam (08–16 WIB) — mengikuti gaya sbdental: tiap slot
   * menampilkan apa yang terjadi/akan terjadi. Status slot DIHITUNG dari
   * kebijakan mesin yang sebenarnya (tick menerbitkan maksimal 1 artikel per
   * jam berurutan dari awal jendela selama kuota masih ada) — bukan tebakan.
   */
  const jadwalRows = $derived.by(() => {
    now;
    const { startHour, endHour, nowHour, publishedToday = 0, dailyCount } = sched;
    if (startHour == null || endHour == null || nowHour == null) return [];
    const rows = [];
    for (let h = startHour; h < endHour; h++) {
      const hh = String(h).padStart(2, '0') + ':00';
      const expected = h - startHour + 1; // slot ke-N sejak awal jendela
      let state = 'wait';
      let text = 'menunggu';
      if (h < nowHour) {
        if (dailyCount != null && publishedToday >= Math.min(expected, dailyCount)) {
          state = 'done';
          text = '✓ terbit';
        } else if (dailyCount != null && expected > dailyCount) {
          state = 'off';
          text = 'di luar kuota harian';
        } else if (sched.halt) {
          state = 'off';
          text = 'dihentikan manual';
        } else {
          state = 'miss';
          text = '— tidak terbit (antrean habis)';
        }
      } else if (h === nowHour) {
        if (sched.halt) {
          state = 'off';
          text = 'dihentikan manual';
        } else if (dailyCount != null && publishedToday >= dailyCount) {
          state = 'done';
          text = 'kuota hari ini terpenuhi';
        } else {
          state = 'now';
          text = untilText ? `berikutnya · ${untilText}` : (sched.nextReason || 'menunggu tik berikutnya');
        }
      } else {
        if (dailyCount != null && publishedToday >= dailyCount) {
          state = 'done';
          text = 'kuota hari ini terpenuhi';
        } else if ((sched.drafts ?? 0) > 0) {
          state = 'wait';
          text = 'menunggu · draf siap dikirim';
        } else {
          state = 'off';
          text = 'antrean kosong';
        }
      }
      rows.push({ hh, state, text });
    }
    return rows;
  });

  // ── hero ──────────────────────────────────────────────────────────────────
  const heroEyebrow = $derived.by(() => {
    if (sched.halt) return 'MESIN PUBLIKASI DIHENTIKAN';
    if (alerts.some((a) => a?.level === 'critical')) return 'MESIN BERJALAN · ADA CATATAN KRITIS';
    if (d?.checks?._meta?.overall === 'ok') return 'MESIN SEO AKTIF · SEMUA PEMERIKSAAN BAIK';
    return 'MESIN SEO AKTIF';
  });
  const heroStats = $derived([
    { v: num(d?.counts?.live ?? 0), l: 'artikel terbit' },
    { v: num(sched.drafts ?? d?.queue?.counts?.draft ?? 0), l: 'draf siap terbit' },
    { v: num(d?.queue?.total ?? 0), l: 'kata kunci dipantau' },
    { v: rateStr, l: 'alamat masuk pencarian' },
  ]);
  const nextLabel = $derived.by(() => {
    now;
    if (sched.halt) return 'dihentikan';
    if (!sched.nextAt) return '—';
    return new Date(sched.nextAt).toTimeString().slice(0, 5) + ' WIB';
  });
  const nextSub = $derived.by(() => {
    now;
    if (sched.halt) return sched.halt_reason || 'publish dihentikan manual';
    if (sched.quotaLeft != null && sched.quotaLeft <= 0) return 'kuota hari ini terpenuhi';
    if (untilText) return `${untilText} · ${sched.nextReason || 'dalam jendela'}`;
    return sched.nextReason || (sched.inWindow ? 'dalam jendela kerja' : 'di luar jendela kerja');
  });

  // ── alur produksi (donut antrean + legenda %) ─────────────────────────────
  const ALUR = $derived.by(() => {
    const c = d?.queue?.counts || {};
    const total = d?.queue?.total || 0;
    const map = [
      ['pending', 'Belum dimulai', 'var(--gold)'],
      ['draft', 'Draf siap', 'var(--sky)'],
      ['published', 'Terbit', 'var(--ok)'],
      ['dropped', 'Dibuang', 'var(--clay)'],
    ];
    const rows = map.map(([k, label, color]) => ({
      label, color, value: c[k] || 0,
      pct: total ? Math.round(((c[k] || 0) / total) * 100) + '%' : '0%',
    }));
    const segs = rows.filter((r) => r.value > 0).map((r) => ({ label: r.label, value: r.value, color: r.color }));
    return { rows, segs, total };
  });

  // ── tren Google (30 hari, ditulis harian oleh seo/gsc-history.mjs) ────────
  const hist = $derived(d?.gsc?.history || []);
  const histLabels = $derived(hist.map((x) => x.date));
  const agg = $derived(d?.gsc?.agg || null);

  // ── kesehatan situs (diperiksa langsung harian) + Data Google ─────────────
  const healthRows = $derived.by(() => {
    const c = d?.checks;
    const defs = [
      ['robots', 'Akses Mesin Pencari', 'Mesin pencari diizinkan mengakses situs'],
      ['sitemap', 'Peta Situs', c?.sitemap?.urls ? `${num(c.sitemap.urls)} alamat terdaftar di peta situs` : 'Daftar alamat untuk mesin pencari'],
      ['llms', 'Info untuk AI', 'Info untuk AI tersedia'],
      ['indexnow', 'Notifikasi ke Mesin Pencari', 'Notifikasi otomatis tiap ada artikel baru'],
      ['beranda', 'Halaman Inti', 'Halaman utama bisa diakses'],
    ].map(([k, name, desc]) => ({ name, desc, status: c?.[k]?.status || null }));
    const gscDesc = agg
      ? `${num(agg.clicks)} klik · ${num(agg.impressions)} tayangan${agg.period ? ` (${agg.period.start} → ${agg.period.end})` : ''}`
      : (d?.gsc?.historyNote || 'Menunggu pengukuran — situs baru wajar');
    return [...defs, { name: 'Data Google', desc: gscDesc, status: agg ? 'ok' : null }];
  });

  // ── segmen tayang/draf/konten untuk referensi ringkas ─────────────────────
  const redirectNote = $derived(num(d?.counts?.redirects ?? 0));
</script>

<PageHead title="Beranda" sub="Keadaan SEO {d?.site || 'valleycityview.id'} saat ini">
  <button class="btn ghost sm" onclick={() => data.refresh()} disabled={data.loading}><Icon name="refresh" size={15} cls={data.loading ? 'spin' : ''} /> Segarkan</button>
  <button class="btn gold sm" onclick={() => router.go('/runs')}><Icon name="play" size={15} /> Kerjakan sekarang</button>
</PageHead>

<!-- Hero ala sbdental: status mesin + angka utama + terbit berikutnya -->
<div class="hero">
  <div class="hero-l">
    <span class="hero-eyebrow"><span class="hdot"></span>{heroEyebrow}</span>
    <h1 class="hero-title">Valley City tumbuh di Google, otomatis.</h1>
    <p class="hero-sub">Sistem menulis, menjadwalkan, dan menerbitkan artikel setiap jam kerja — lalu melaporkan hasilnya ke Anda.</p>
    <div class="hero-stats">
      {#each heroStats as st}
        <div class="hs"><b>{st.v}</b><span>{st.l}</span></div>
      {/each}
    </div>
  </div>
  <div class="hero-r">
    <div class="next-box">
      <span class="nb-l">TERBIT BERIKUTNYA</span>
      <b class="nb-v">{nextLabel}</b>
      <span class="nb-s">{nextSub}</span>
    </div>
    <button class="btn gold" onclick={() => router.go('/queue')}>Lihat antrean kata kunci</button>
  </div>
</div>

<div class="grid g4">
  <Kpi i={0} label="Dibuat hari ini" value={pr.createdToday ?? 0} note="draf baru dari mesin penulis" tone="ok" spark={createdSpark} sparkColor="var(--gold)" />
  <Kpi i={1} label="Terbit hari ini" value={pr.publishedToday ?? 0} note={sched.dailyCount != null ? `kuota ${sched.dailyCount}/hari` : 'kuota belum diatur'} tone="teal" spark={publishedSpark} sparkColor="var(--teal)" />
  <Kpi i={2} label="Siap tayang" value={sched.drafts ?? 0} note="{num(d?.queue?.counts?.pending)} menunggu ditulis" tone="warn" />
  <Kpi i={3} label="Jadwal berikutnya" value={nextLabel} note={nextSub} tone={sched.inWindow ? 'teal' : ''} />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Jadwal tayang hari ini" sub={sched.startHour != null ? `${sched.startHour}:00–${sched.endHour}:00 WIB · 1 artikel per jam · ${num(sched.publishedToday ?? 0)}/${num(sched.dailyCount ?? 0)} terbit${sched.halt ? ' · DIHENTIKAN' : ''}` : 'menunggu konfigurasi jendela'}>
    {#if jadwalRows.length}
      <div class="slots">
        {#each jadwalRows as r}
          <div class="sl {r.state}">
            <span class="st">{r.hh}</span>
            <span class="sdot" aria-hidden="true"></span>
            <span class="sx">{r.text}</span>
          </div>
        {/each}
      </div>
      <p class="note">Satu artikel terbit per jam selama jendela terbuka — status slot dihitung dari kuota harian & jendela kerja mesin.</p>
    {:else}
      <p class="note">Jadwal belum terbaca — jalankan siklus harian sekali untuk menghitung jendela.</p>
    {/if}
  </Card>

  <Card i={5} title="Alur produksi konten" sub="kata kunci → ditulis → diterbitkan">
    {#if ALUR.segs.length}
      <div class="alur">
        <Donut segments={ALUR.segs} size={150} centerSub="antrean" />
        <ul class="legend">
          {#each ALUR.rows as lg}
            <li class={lg.value ? '' : 'zero'}>
              <span class="ldot" style="background:{lg.color}"></span>
              <span class="ll">{lg.label}</span>
              <b>{num(lg.value)}</b>
              <span class="lp">{lg.pct}</span>
            </li>
          {/each}
        </ul>
      </div>
      <p class="note">Tahap: menunggu → ditulis → terbit. Termasuk {redirectNote} alamat lama yang dialihkan (bukan artikel baru).</p>
      <button class="btn ghost sm" onclick={() => router.go('/queue')}><Icon name="list" size={14} /> Rincian antrean</button>
    {:else}
      <p class="note">Antrean belum terbaca.</p>
    {/if}
  </Card>
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={6} title="Tren 30 hari" sub="Klik & tayangan harian · data Google">
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
      <p class="note">{d?.gsc?.historyNote || 'Belum ada pengukuran — diisi otomatis oleh siklus harian.'}</p>
    {/if}
  </Card>
  <Card i={7} title="Posisi rata-rata" sub="semakin kecil semakin mendekati halaman pertama">
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
  <Card i={8} title="Data Google" sub="28 hari · ringkasan pencarian">
    {#if agg}
      <div class="mini-stats">
        <div><span>Klik</span><b>{num(agg.clicks)}</b></div>
        <div><span>Tayangan</span><b>{num(agg.impressions)}</b></div>
        <div><span>Rasio klik</span><b>{agg.ctr == null ? '—' : pct(agg.ctr, 2)}</b></div>
        <div><span>Posisi</span><b>{agg.position == null ? '—' : num(agg.position)}</b></div>
      </div>
      <p class="note">Periode {agg.period?.start} → {agg.period?.end}</p>
    {:else}
      <p class="note">{d?.gsc?.historyNote || 'Data Google sedang dikumpulkan — biasanya muncul 1–2 minggu setelah artikel tayang.'}</p>
    {/if}
  </Card>

  <Card i={9} title="Kesehatan situs" sub={d?.checks?._meta ? `diperiksa ${ago(d.checks._meta.checkedAt)} · ${d.checks._meta.ok}/${d.checks._meta.total} lolos` : 'diperiksa langsung ke situs setiap hari'}>
    {#if healthRows.length && d?.checks}
      <div class="hsgrid">
        {#each healthRows as h}
          <div class="hsitem {h.status || ''}">
            <span class="hsi {h.status || ''}"><Icon name={h.status === 'ok' ? 'check' : h.status === 'fail' ? 'x' : h.status === 'warn' ? 'alert' : 'clock'} size={13} /></span>
            <div class="hst"><b>{h.name}</b><span>{h.desc}</span></div>
          </div>
        {/each}
      </div>
      <button class="btn ghost sm" style="margin-top:10px" onclick={() => router.go('/health')}><Icon name="shield" size={14} /> Detail sistem</button>
    {:else}
      <p class="note">Pemeriksaan langsung ke situs berjalan tiap hari bersama siklus harian — hasilnya muncul di sini.</p>
    {/if}
  </Card>
</div>

{#if alerts.length}
  <div style="margin-top:14px">
    <Card i={10} title="Perlu perhatian" sub="{alerts.length} catatan · semua angka nyata">
      {#each alerts as a, i}
        <div class="callout {i === 0 ? 'bad' : ''}">{typeof a === 'string' ? a : (a.msg || a.message || JSON.stringify(a))}</div>
      {/each}
      <p class="note">Kuota tayang: <b>{num(s.dailyCount ?? sched.dailyCount)}</b> artikel per hari — disetel otomatis oleh mesin, bukan manual.</p>
      <button class="btn ghost sm" onclick={() => router.go('/alerts')}><Icon name="bell" size={14} /> Buka peringatan</button>
    </Card>
  </div>
{/if}

<style>
  /* Hero — gradien hijau tua → hijau cerah, aksen emas (identitas Valley City). */
  .hero {
    display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
    background: linear-gradient(125deg, #0d3a2a 0%, #14684a 55%, #1c8a5f 100%);
    color: #fff; padding: 26px 28px; border-radius: var(--radius-lg, 16px);
    box-shadow: var(--shadow); position: relative; overflow: hidden;
    animation: heroIn .5s var(--ease, ease) both;
  }
  @keyframes heroIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .hero-l { flex: 1 1 420px; min-width: 0; }
  .hero-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; opacity: .9; }
  .hdot { width: 8px; height: 8px; border-radius: 50%; background: #6ee7b7; box-shadow: 0 0 0 4px rgba(110, 231, 183, .25); }
  .hero-title { margin: 12px 0 6px; font-size: clamp(22px, 3vw, 30px); line-height: 1.15; font-weight: 800; }
  .hero-sub { margin: 0; font-size: 13.5px; line-height: 1.6; opacity: .85; max-width: 54ch; }
  .hero-stats { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 18px; }
  .hs { display: flex; flex-direction: column; gap: 2px; }
  .hs b { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
  .hs span { font-size: 11.5px; opacity: .8; }
  .hero-r { display: flex; flex-direction: column; gap: 12px; align-items: stretch; justify-content: center; min-width: 220px; }
  .next-box { background: rgba(255, 255, 255, .12); border: 1px solid rgba(255, 255, 255, .22); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; text-align: center; }
  .nb-l { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; opacity: .85; }
  .nb-v { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .nb-s { font-size: 11.5px; opacity: .85; }

  /* Jadwal per jam */
  .slots { display: flex; flex-direction: column; gap: 4px; }
  .sl { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid transparent; }
  .sl .st { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink-3); min-width: 44px; }
  .sl .sdot { width: 10px; height: 10px; border-radius: 50%; background: var(--line); flex: none; }
  .sl .sx { font-size: 13px; color: var(--ink-2); }
  .sl.done { background: var(--ok-soft); }
  .sl.done .st, .sl.done .sdot { color: var(--ok); }
  .sl.done .sdot { background: var(--ok); }
  .sl.now { background: var(--gold-soft); border-color: var(--gold); }
  .sl.now .st, .sl.now .sx { color: var(--gold); font-weight: 700; }
  .sl.now .sdot { background: var(--gold); animation: pulse 1.6s ease infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 5px rgba(201, 162, 39, .2); } }
  .sl.miss .sdot { background: var(--bad); }
  .sl.miss .sx { color: var(--ink-3); }
  .sl.off { opacity: .55; }

  /* Alur: donut + legenda persen */
  .alur { display: flex; gap: 18px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 4px 0; }
  .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-width: 210px; }
  .legend li { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--ink-2); }
  .legend li.zero { opacity: .5; }
  .legend .ldot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .legend .ll { flex: 1; }
  .legend b { font-variant-numeric: tabular-nums; }
  .legend .lp { color: var(--ink-4); font-size: 12px; min-width: 34px; text-align: right; }

  /* Data Google mini-stats */
  .mini-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mini-stats div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: var(--surface-2); border-radius: 10px; border: 1px solid var(--line); }
  .mini-stats span { font-size: 11.5px; color: var(--ink-3); }
  .mini-stats b { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }

  /* Kesehatan situs: grid deskriptif ala sbdental */
  .hsgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .hsitem { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 11px; background: var(--surface-2); border: 1px solid var(--line); }
  .hsi { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; flex: none; background: var(--surface-3); color: var(--ink-4); }
  .hsi.ok { background: var(--ok-soft); color: var(--ok); }
  .hsi.fail { background: var(--bad-soft); color: var(--bad); }
  .hsi.warn { background: var(--warn-soft); color: var(--warn); }
  .hst { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hst b { font-size: 12.5px; color: var(--ink); }
  .hst span { font-size: 11.5px; color: var(--ink-3); line-height: 1.45; }

  @media (max-width: 720px) {
    .hsgrid { grid-template-columns: 1fr; }
    .mini-stats { grid-template-columns: 1fr; }
    .hero { padding: 20px; }
  }
</style>
