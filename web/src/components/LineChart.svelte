<script>
  /**
   * LineChart — grafik garis time-series (SVG murni, tanpa library).
   * Mendukung: dua sumbu (klik kiri + tayangan kanan), sumbu-Y terbalik
   * (posisi rata-rata — makin kecil makin bagus, ditaruh di atas), area
   * isian, garis putus-putus, tick rapih, dan tooltip titik terdekat.
   *
   * Aturan orientasi (diuji lewat screenshot, jangan diutak-atik sembarangan):
   *  - normal : nilai BESAR di atas   (klik/tayangan)
   *  - yReverse: nilai KECIL di atas   (posisi — makin kecil makin baik)
   * Domain pakai rentang data ALAMI (tanpa dipaksa nol), jadi garis memakai
   * seluruh tinggi chart; label & garis grid dihitung dari domain yang sama.
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

  const W = 720;
  const PAD = { l: 46, r: 46, t: 12, b: 24 };
  const inner = h - PAD.t - PAD.b;
  const innerW = W - PAD.l - PAD.r;

  const hasData = $derived(series.some((s) => (values[s.key] || []).some((v) => v != null)));

  function domainFor(axis) {
    const vals = series
      .filter((s) => (s.axis || 'left') === axis)
      .flatMap((s) => (values[s.key] || []).filter((v) => v != null));
    if (!vals.length) return null;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) hi = lo + 1;
    return { lo, hi };
  }
  const domL = $derived(domainFor('left'));
  const domR = $derived(domainFor('right'));
  const domOf = (axis) => (axis === 'right' ? domR : domL);

  /** Nilai → piksel-Y. */
  function yOf(v, dom, axis) {
    if (!dom) return h / 2;
    const rev = axis === 'left' && yReverse;
    const g = (v - dom.lo) / (dom.hi - dom.lo || 1);
    return PAD.t + (rev ? g : 1 - g) * inner;
  }
  /** Baris grid f (0 = atas) → nilai yang ada di piksel itu. */
  function valueAt(axis, f) {
    const dom = domOf(axis);
    if (!dom) return null;
    const rev = axis === 'left' && yReverse;
    return rev ? dom.lo + (dom.hi - dom.lo) * f : dom.lo + (dom.hi - dom.lo) * (1 - f);
  }

  const xOf = (i) => PAD.l + (labels.length > 1 ? (i / (labels.length - 1)) * innerW : innerW / 2);

  function pathFor(key, axis) {
    const dom = domOf(axis);
    if (!dom) return '';
    const vals = values[key] || [];
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v, dom, axis).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }
  function areaFor(key, axis) {
    const dom = domOf(axis);
    if (!dom) return '';
    const pts = (values[key] || []).map((v, i) => (v == null ? null : [xOf(i), yOf(v, dom, axis)])).filter(Boolean);
    if (pts.length < 2) return '';
    const base = h - PAD.b;
    return `M${pts[0][0].toFixed(1)},${base} ` +
      pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ` L${pts[pts.length - 1][0].toFixed(1)},${base} Z`;
  }

  /** Tick rapih (1/2/2.5/5 × 10^k), maks 4 garis. */
  function niceTicks(dom) {
    if (!dom) return [];
    const raw = (dom.hi - dom.lo) / 3 || 1;
    const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || 10 * pow;
    const out = [];
    for (let v = Math.ceil(dom.lo / step) * step; v <= dom.hi + step * 1e-9 && out.length < 4; v += step) {
      out.push(Math.round(v * 100) / 100);
    }
    if (out.length < 2) return [dom.lo, dom.hi];
    return out;
  }
  const ticksL = $derived(niceTicks(domL));
  const ticksR = $derived(domR ? niceTicks(domR) : []);

  // tooltip: indeks titik terdekat
  let hover = $state(-1);
  let wrapEl = $state(null);
  function onMove(e) {
    if (!wrapEl || !labels.length) return;
    const r = wrapEl.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const t = (fx - PAD.l) / (innerW || 1);
    hover = Math.max(0, Math.min(labels.length - 1, Math.round(t * (labels.length - 1))));
  }
  const tipLeft = $derived.by(() => (hover >= 0 ? (xOf(hover) / W) * 100 : 0));

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
      <!-- grid + label kiri (pakai domain kiri; kalau kiri kosong, garis dari domain kanan) -->
      {#each (ticksL.length ? ticksL : ticksR) as v}
        {@const y = yOf(v, ticksL.length ? domL : domR, ticksL.length ? 'left' : 'right')}
        <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} class="grid" />
        {#if ticksL.length}<text x={PAD.l - 6} y={y + 3} class="yl" text-anchor="end">{formatLeft(v)}</text>{/if}
      {/each}
      <!-- label kanan (tanpa garis tambahan, hindari tabrakan) -->
      {#each ticksR as v}
        <text x={W - PAD.r + 6} y={yOf(v, domR, 'right') + 3} class="yl yr" text-anchor="start">{formatRight(v)}</text>
      {/each}

      {#each xTicks as i}
        <text x={xOf(i)} y={h - 6} class="xl" text-anchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{xFormat(labels[i])}</text>
      {/each}

      {#each series as s}
        {@const axis = s.axis || 'left'}
        {#if s.fill && pathFor(s.key, axis)}
          <path d={areaFor(s.key, axis)} fill={s.color} opacity="0.10" />
        {/if}
      {/each}
      {#each series as s}
        {@const axis = s.axis || 'left'}
        <path
          d={pathFor(s.key, axis)}
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
          {@const axis = s.axis || 'left'}
          {@const v = (values[s.key] || [])[hover]}
          {#if v != null && domOf(axis)}
            <circle cx={xOf(hover)} cy={yOf(v, domOf(axis), axis)} r="3.5" fill={s.color} stroke="var(--surface)" stroke-width="1.5" />
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
