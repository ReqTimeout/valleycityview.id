<script>
  import { num } from '../lib/format.js';
  let { parts = [] } = $props();
  const total = $derived(parts.reduce((a, p) => a + (p.value || 0), 0));
  const vis = $derived(parts.filter((p) => p.value > 0));
</script>

{#if total}
  <div class="bar">{#each vis as p}<i style="width:{(p.value / total) * 100}%;background:{p.color}" title="{p.label}: {num(p.value)}"></i>{/each}</div>
  <div class="legend">{#each vis as p}<span><span class="sw" style="background:{p.color}"></span><b>{p.label}</b> {num(p.value)}</span>{/each}</div>
{:else}
  <p class="note">Belum ada data untuk ditampilkan.</p>
{/if}