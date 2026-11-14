<script>
  import Icon from './Icon.svelte';
  let { open = false, title = '', sub = '', onClose, children } = $props();

  $effect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="drawer-scrim {open ? 'open' : ''}" role="button" tabindex="-1" aria-label="Tutup detail" onclick={onClose} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose?.(); }}></div>
<div class="drawer {open ? 'open' : ''}" aria-hidden={!open} role="dialog" aria-modal="true" aria-label={title}>
  <div class="drawer-h">
    <div style="min-width:0">
      <h3>{title}</h3>
      {#if sub}<div class="sub">{sub}</div>{/if}
    </div>
    <button class="icon-btn drawer-close" onclick={onClose} aria-label="Tutup"><Icon name="x" /></button>
  </div>
  <div class="drawer-b">{@render children?.()}</div>
</div>