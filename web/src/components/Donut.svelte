<script>
  import { pct } from '../lib/format.js';
  let { value = null, size = 120, label = '', color = 'var(--ok)' } = $props();
  const r = 46;
  const c = 2 * Math.PI * r;
  const frac = $derived(value == null ? 0 : Math.max(0, Math.min(1, value)));
</script>

<div class="donut">
  <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="{label} {value == null ? 'belum diukur' : pct(value, 0)}">
    <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" stroke-width="12" />
    {#if value != null}
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} stroke-width="12" stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - frac)} transform="rotate(-90 60 60)" style="transition:stroke-dashoffset .8s var(--ease)" />
    {/if}
    <text x="60" y="58" text-anchor="middle" class="dv">{value == null ? '—' : pct(value, 0)}</text>
    <text x="60" y="76" text-anchor="middle" class="dl">{label}</text>
  </svg>
</div>

<style>
  .donut { display: inline-grid; place-items: center; }
  .dv { fill: var(--ink); font-size: 22px; font-weight: 700; font-family: var(--font); }
  .dl { fill: var(--ink-3); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-family: var(--font); }
</style>