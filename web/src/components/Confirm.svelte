<script>
  import { ui, data } from '../lib/state.svelte.js';
  const c = $derived(ui.confirm);
  $effect(() => {
    if (!c) return;
    const onKey = (e) => { if (e.key === 'Escape') ui.closeConfirm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  function proceed() {
    const opts = c;
    ui.closeConfirm();
    if (opts?.action) data.run(opts.action, opts.label || 'Aksi');
  }
</script>

{#if c}
  <div class="drawer-scrim open" role="button" tabindex="-1" aria-label="Tutup dialog" onclick={() => ui.closeConfirm()} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') ui.closeConfirm(); }}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label={c.title}>
    <h3>{c.title}</h3>
    <p class="note">{c.body}</p>
    <div class="modal-actions">
      <button class="btn ghost" onclick={() => ui.closeConfirm()}>Batal</button>
      <button class="btn gold" onclick={proceed}>{c.label || 'Lanjutkan'}</button>
    </div>
  </div>
{/if}