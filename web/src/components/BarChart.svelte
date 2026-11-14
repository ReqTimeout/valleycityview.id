<script>
  import { num } from '../lib/format.js';
  let { items = [], max = null } = $props();
  const palette = ['var(--gold)', 'var(--teal)', 'var(--sky)', 'var(--clay)', 'var(--plum)', 'var(--ok)', 'var(--info)', 'var(--forest-3)'];
  const top = $derived(items.slice(0, 12));
  const peak = $derived(max ?? Math.max(1, ...top.map((d) => d.value || 0)));
</script>

<div class="barchart">
  {#each top as d, idx}
    <div class="brow">
      <span class="blabel" title={d.label}>{d.label}</span>
      <span class="btrack"><i style="width:{((d.value || 0) / peak) * 100}%;background:{d.color || palette[idx % palette.length]}"></i></span>
      <span class="bval">{num(d.value)}</span>
    </div>
  {/each}
</div>

<style>
  .barchart { display: flex; flex-direction: column; gap: 9px; }
  .brow { display: grid; grid-template-columns: minmax(90px, 1.4fr) 2fr auto; gap: 10px; align-items: center; }
  .blabel { font-size: 12.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btrack { background: var(--line); border-radius: 6px; height: 12px; overflow: hidden; }
  .btrack i { display: block; height: 100%; border-radius: 6px; transition: width .6s var(--ease); min-width: 2px; }
  .bval { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }
  @media (max-width: 520px) { .brow { grid-template-columns: minmax(70px, 1.2fr) 1.6fr auto; } }
</style>