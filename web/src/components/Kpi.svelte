<script>
  import { num } from '../lib/format.js';
  import Sparkline from './Sparkline.svelte';
  let { label, value, note = '', tone = '', i = 0, spark = null, sparkColor = 'var(--gold)' } = $props();
  let display = $state(0);
  const isNum = $derived(typeof value === 'number' && Number.isFinite(value));

  $effect(() => {
    if (!isNum) return;
    const target = value;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { display = target; return; }
    const dur = 700;
    let start = null, raf;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      display = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="cell kpi reveal {tone ? 'tone-' + tone : ''}" style="--i:{i}">
  <div class="l">{label}</div>
  <div class="v {isNum ? '' : 'v-text'}">{isNum ? num(display) : (value ?? '—')}</div>
  {#if spark && spark.length >= 2}
    <div class="sp"><Sparkline points={spark.map((n) => ({ value: n }))} h={30} color={sparkColor} /></div>
  {/if}
  {#if note}<div class="n">{note}</div>{/if}
</div>

<style>
  .sp { margin: 4px 0 2px; opacity: .9; }
</style>