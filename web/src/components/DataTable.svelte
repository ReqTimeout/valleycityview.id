<script>
  import Icon from './Icon.svelte';
  import Chip from './Chip.svelte';
  import EmptyState from './EmptyState.svelte';
  import { num } from '../lib/format.js';
  let { columns = [], rows = [], searchKeys = [], placeholder = 'Cari…', onRowClick, toolbar, empty = 'Tidak ada baris.', pageSize = 40, rowKey } = $props();
  let q = $state('');
  let sortKey = $state(null);
  let sortDir = $state(1);
  // svelte-ignore state_referenced_locally
  let limit = $state(pageSize);

  const filtered = $derived.by(() => {
    let r = rows || [];
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((row) => searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(t)));
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      const sv = col?.sortVal || ((x) => x[sortKey]);
      r = [...r].sort((a, b) => {
        const va = sv(a), vb = sv(b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
      });
    }
    return r;
  });
  const shown = $derived(filtered.slice(0, limit));
  function toggleSort(c) { if (!c.sortable) return; if (sortKey === c.key) sortDir *= -1; else { sortKey = c.key; sortDir = 1; } }
  const key = (row, i) => (rowKey ? rowKey(row) : (row.slug ?? row.url ?? row.query ?? row.id ?? i));
</script>

<div class="toolbar">
  <label class="search"><Icon name="search" size={16} /><input bind:value={q} {placeholder} aria-label={placeholder} /></label>
  {@render toolbar?.()}
  <span class="count-pill">{num(filtered.length)} baris</span>
</div>
<div class="scroll">
  <table>
    <thead>
      <tr>{#each columns as c}<th class="{c.align === 'r' ? 'r' : ''} {c.sortable ? 'sortable' : ''}" onclick={() => toggleSort(c)}>{c.label}{#if sortKey === c.key}<span class="arrow">{sortDir > 0 ? '▲' : '▼'}</span>{/if}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each shown as row, i (key(row, i))}
        <tr class={onRowClick ? 'clickable' : ''} onclick={() => onRowClick?.(row)}>
          {#each columns as c}
            <td class="{c.align === 'r' ? 'r' : ''} {c.mono ? 'mono' : ''}">
              {#if c.chip && c.chip(row)}{@const cv = c.chip(row)}{#if typeof cv === 'object'}<Chip value={cv.value} label={cv.label} kind={cv.kind} />{:else}<Chip value={cv} />{/if}
              {:else if c.href && c.href(row)}<a href={c.href(row)} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>{c.get(row)}</a>
              {:else}{c.get(row)}{/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !filtered.length}<EmptyState note={empty} />{/if}
</div>
{#if filtered.length > limit}
  <button class="btn ghost sm" style="margin-top:10px" onclick={() => (limit += pageSize)}>Tampilkan {Math.min(pageSize, filtered.length - limit)} lagi</button>
{/if}