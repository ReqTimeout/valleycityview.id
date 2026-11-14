<script>
  let { points = [], w = 260, h = 44, color = 'var(--gold)' } = $props();
  const vals = $derived(points.filter((p) => p.value != null));
  const max = $derived(Math.max(1, ...vals.map((p) => p.value)));
  const step = $derived(w / Math.max(1, points.length - 1));
  const ok = $derived(points.map((p, i) => (p.value == null ? null : [i * step, h - (p.value / max) * (h - 6) - 3])).filter(Boolean));
  const d = $derived(ok.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
</script>

{#if ok.length >= 2}
  <svg viewBox="0 0 {w} {h}" width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="tren">
    <path d={d} fill="none" stroke={color} stroke-width="1.5" />
    {#each ok as [x, y]}<circle cx={x} cy={y} r="2" fill={color} />{/each}
  </svg>
{:else}
  <span class="note">belum cukup data untuk tren</span>
{/if}