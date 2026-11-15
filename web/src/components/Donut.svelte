<script>
  import { pct, num } from '../lib/format.js';
  /**
   * Donut — dua mode:
   *  1) fraksi tunggal: value 0..1 (skor, rasio) + label tengah. (mode lama)
   *  2) multi-segmen: `segments=[{label,value,color}]` — donut pipeline
   *     multi-status dengan legenda klik-filter (nilai total di tengah).
   */
  let { value = null, size = 120, label = '', color = 'var(--ok)', segments = null, centerTop = '', centerSub = '' } = $props();
  const r = 46;
  const c = 2 * Math.PI * r;
  const frac = $derived(value == null ? 0 : Math.max(0, Math.min(1, value)));

  const palette = ['var(--gold)', 'var(--teal)', 'var(--sky)', 'var(--clay)', 'var(--plum)', 'var(--ok)', 'var(--info)', 'var(--forest-3)'];
  const multi = $derived(Array.isArray(segments) && segments.length > 0);
  const total = $derived(multi ? segments.reduce((a, s) => a + (s.value || 0), 0) : 0);
  // offset kumulatif per segmen (dalam unit dasharray)
  const arcs = $derived.by(() => {
    if (!multi || !total) return [];
    let acc = 0;
    return segments.filter((s) => s.value > 0).map((s, i) => {
      const len = (s.value / total) * c;
      const off = acc;
      acc += len;
      return { ...s, len, off, color: s.color || palette[i % palette.length] };
    });
  });
</script>

<div class="donut">
  <svg viewBox="0 0 120 120" width={size} height={size} role="img"
    aria-label={multi ? `donut ${total} total` : `${label} ${value == null ? 'belum diukur' : pct(value, 0)}`}>
    <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" stroke-width="12" />
    {#if multi}
      {#each arcs as a}
        <circle cx="60" cy="60" r={r} fill="none" stroke={a.color} stroke-width="12"
          stroke-dasharray="{a.len.toFixed(2)} {(c - a.len).toFixed(2)}"
          stroke-dashoffset={-a.off}
          transform="rotate(-90 60 60)">
          <title>{a.label}: {num(a.value)}</title>
        </circle>
      {/each}
      <text x="60" y="57" text-anchor="middle" class="dv">{centerTop || num(total)}</text>
      <text x="60" y="75" text-anchor="middle" class="dl">{centerSub || label}</text>
    {:else}
      {#if value != null}
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} stroke-width="12" stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - frac)} transform="rotate(-90 60 60)" style="transition:stroke-dashoffset .8s var(--ease)" />
      {/if}
      <text x="60" y="58" text-anchor="middle" class="dv">{value == null ? '—' : pct(value, 0)}</text>
      <text x="60" y="76" text-anchor="middle" class="dl">{label}</text>
    {/if}
  </svg>
  {#if multi}
    <div class="mlegend">
      {#each arcs as a}
        <span title="{a.label}: {num(a.value)}"><i style="background:{a.color}"></i><b>{a.label}</b> {num(a.value)}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .donut { display: inline-grid; place-items: center; gap: 10px; }
  .dv { fill: var(--ink); font-size: 22px; font-weight: 700; font-family: var(--font); }
  .dl { fill: var(--ink-3); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-family: var(--font); }
  .mlegend { display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: center; font-size: 12px; color: var(--ink-2); max-width: 320px; }
  .mlegend span { display: inline-flex; align-items: center; gap: 6px; }
  .mlegend i { width: 9px; height: 9px; border-radius: 3px; }
  .mlegend b { font-weight: 600; }
</style>
