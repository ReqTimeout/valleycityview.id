<script>
  /**
   * LineChart — grafik garis time-series (SVG murni, tanpa library).
   * Mendukung: dua sumbu (klik kiri + tayangan kanan), sumbu-Y terbalik
   * (posisi rata-rata — makin kecil makin bagus, ditaruh di atas), area
   * isian, garis putus-putus, dan tooltip titik terdekat saat kursor masuk.
   *
   * props:
   *   labels: string[]           — sumbu X (mis. '2026-11-01')
   *   series: [{key,label,color,axis?,fill?,dashed?}]  axis: 'left'|'right'
   *   values: { [key]: (number|null)[] } per seri (sepanjang labels)
   *   h tinggi, yReverse sumbu kiri terbalik, formatLeft/formatRight fn
   */
  import { num } from '../lib/format.js';
  let {
    labels = [],
    series = [],
    values = {},
    h = 220,
    yReverse = false,
    xFormat = (v) => String(v).slice(5),
    formatLeft = (v) => num(Math.round(v * 10) / 10),
    formatRight = (v) => num(Math.round(v * 10) / 10),
    empty = 'Belum ada pengukuran — grafik muncul setelah data masuk.',
  } = $props();

  const W = 720; // ruang koordinat virtual (skala responsif via preserveAspectRatio)
  const PAD = { l: 44, r: 44, t: 12, b: 24 };

  const hasData = $derived(
    series.some((s) => (values[s.key] || []).some((v) => v != null))
  );

  function scaleFor(axis, invert) {
    const keys = series.filter((s) => (s.axis || 'left') === axis).map((s) => s.key);
    const vals = keys.flatMap((k) => (values[k] || []).filter((v) => v != null));
    if (!vals.length) return null;
    let min = Math.min(0, ...vals);
    let max = Math.max(...vals);
    if (yReverse && axis === 'left') {
      // posisi: nilai kecil = performa baik → taruh di atas (min di atas)
      const t = min; min = Math.max(...vals); max = t;
    } else if (min === max) {
      max = min + 1;
    }
    const lo = Math.min(min, max);
    const hi = Math.max(min, max) === lo ? lo + 1 : Math.max(min, max);
    const inner = h - PAD.t - PAD.b;
    return (v) => {
      const f = (v - lo) / (hi - lo || 1);
      const g = yReverse && axis === 'left' ? f : f; // arah sudah ditangani min/max swap
      return PAD.t + (yReverse && axis === 'left' ? g : 1 - g) * inner;
    };
  }

  const scaleL = $derived(scaleFor('left'));
  const scaleR = $derived(scaleFor('right'));

  const innerW = W - PAD.l - PAD.r;
  const xOf = (i) => PAD.l + (labels.length > 1 ? (i / (labels.length - 1)) * innerW : innerW / 2);

  function pathFor(key, scale) {
    const vals = values[key] || [];
    if (!scale) return '';
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const x = xOf(i);
      const y = scale(v);
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }
  function areaFor(key, scale) {
    const vals = values[key] || [];
    const pts = vals.map((v, i) => (v == null ? null : [xOf(i), scale(v)])).filter(Boolean);
    if (pts.length < 2 || !scale) return '';
    const base = h - PAD.b;
    return `M${pts[0][0].toFixed(1)},${base} ` +
      pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ` L${pts[pts.length - 1][0].toFixed(1)},${base} Z`;
  }

  // tick Y kiri/kanan (4 garis)
  const gridY = $derived.by(() => {
    const rows = [];
    for (let k = 0; k <= 3; k++) rows.push(k / 3);
    return rows;
  });
  function yLabelAt(axis, frac) {
    const keys = series.filter((s) => (s.axis || 'left') === axis).map((s) => s.key);
    const vals = keys.flatMap((k) => (values[k] || []).filter((v) => v != null));
    if (!vals.length) return '';
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (yReverse && axis === 'left') { const t = lo; lo = hi; hi = t; }
    if (lo === hi) hi = lo + 1;
    const v = lo + (hi - lo) * frac;
    return (axis === 'right' ? formatRight : formatLeft)(v);
  }

  // tooltip: indeks titik terdekat
  let hover = $state(-1);
  let wrapEl = $state(null);
  function onMove(e) {
    if (!wrapEl || !labels.length) return;
    const r = wrapEl.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const t = (fx - PAD.l) / (innerW || 1);
    const i = Math.round(t * (labels.length - 1));
    hover = Math.max(0, Math.min(labels.length - 1, i));
  }
  const tipLeft = $derived.by(() => {
    if (!wrapEl || hover < 0) return 0;
    return (xOf(hover) / W) * 100;
  });

  const xTicks = $derived.by(() => {
    const n = labels.length;
    const step = Math.max(1, Math.ceil(n / 7));
    const out = [];
    for (let i = 0; i < n; i += step) out.push(i);
    if (out[out.length - 1] !== n - 1 && n > 1) out.push(n - 1);
    return out;
  });
</script>

{#if hasData}
  <div class="lc-wrap" bind:this={wrapEl} role="img" aria-label="Grafik tren — arahkan kursor untuk rincian per titik" onmousemove={onMove} onmouseleave={() => (hover = -1)}>
    <svg viewBox="0 0 {W} {h}" width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="grafik tren">
      {#each gridY as f}
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (h - PAD.t - PAD.b)} y2={PAD.t + f * (h - PAD.t - PAD.b)} class="grid" />
      {/each}
      {#if scaleL}
        {#each gridY as f}
          <text x={PAD.l - 6} y={PAD.t + f * (h - PAD.t - PAD.b) + 3} class="yl" text-anchor="end">{yLabelAt('left', yReverse ? 1 - f : f)}</text>
        {/each}
      {/if}
      {#if scaleR}
        {#each gridY as f}
          <text x={W - PAD.r + 6} y={PAD.t + f * (h - PAD.t - PAD.b) + 3} class="yl yr" text-anchor="start">{yLabelAt('right', f)}</text>
        {/each}
      {/if}
      {#each xTicks as i}
        <text x={xOf(i)} y={h - 6} class="xl" text-anchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{xFormat(labels[i])}</text>
      {/each}

      {#each series as s}
        {@const sc = (s.axis || 'left') === 'right' ? scaleR : scaleL}
        {#if s.fill && sc && pathFor(s.key, sc)}
          <path d={areaFor(s.key, sc)} fill={s.color} opacity="0.10" />
        {/if}
      {/each}
      {#each series as s}
        {@const sc = (s.axis || 'left') === 'right' ? scaleR : scaleL}
        <path
          d={pathFor(s.key, sc)}
          fill="none"
          stroke={s.color}
          stroke-width="2"
          stroke-dasharray={s.dashed ? '5 4' : ''}
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
        />
      {/each}

      {#if hover >= 0 && labels[hover] != null}
        <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD.t} y2={h - PAD.b} class="cross" />
        {#each series as s}
          {@const sc = (s.axis || 'left') === 'right' ? scaleR : scaleL}
          {@const v = (values[s.key] || [])[hover]}
          {#if sc && v != null}
            <circle cx={xOf(hover)} cy={sc(v)} r="3.5" fill={s.color} stroke="var(--surface)" stroke-width="1.5" />
          {/if}
        {/each}
      {/if}
    </svg>

    {#if hover >= 0 && labels[hover] != null}
      <div class="tip" style="left:{tipLeft}%">
        <b>{labels[hover]}</b>
        {#each series as s}
          {@const v = (values[s.key] || [])[hover]}
          <span><i style="background:{s.color}"></i>{s.label}: {v == null ? '—' : (s.axis === 'right' ? formatRight(v) : formatLeft(v))}</span>
        {/each}
      </div>
    {/if}

    <div class="llegend">
      {#each series as s}
        <span><i style="background:{s.color};{s.dashed ? 'opacity:.75;' : ''}"></i>{s.label}</span>
      {/each}
    </div>
  </div>
{:else}
  <p class="note">{empty}</p>
{/if}

<style>
  .lc-wrap { position: relative; }
  svg { display: block; overflow: visible; }
  .grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .cross { stroke: var(--line-2); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
  .yl { fill: var(--ink-4); font-size: 10px; font-family: var(--font); }
  .xl { fill: var(--ink-4); font-size: 10px; font-family: var(--font); }
  .tip {
    position: absolute; top: 4px; transform: translateX(-50%);
    background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px;
    padding: 7px 10px; font-size: 11.5px; box-shadow: var(--shadow-lg);
    pointer-events: none; white-space: nowrap; z-index: 3;
  }
  .tip b { display: block; font-size: 11px; color: var(--ink-3); margin-bottom: 3px; font-weight: 600; }
  .tip span { display: flex; align-items: center; gap: 6px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .tip i, .llegend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .llegend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 11.5px; color: var(--ink-3); }
  .llegend span { display: inline-flex; align-items: center; gap: 6px; }
</style>
