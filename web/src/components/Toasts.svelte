<script>
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state.svelte.js';
</script>

<div class="toast-host">
  {#each ui.toasts as t (t.id)}
    <div class="toast {t.kind}" role="status">
      <Icon name={t.kind === 'bad' ? 'alert' : 'check'} size={17} />
      <span style="flex:1">{t.msg}</span>
      <button class="tclose" onclick={() => ui.dismiss(t.id)} aria-label="Tutup"><Icon name="x" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .tclose { background: none; border: none; color: var(--forest-ink-2); cursor: pointer; display: grid; place-items: center; padding: 2px; border-radius: 6px; }
  .tclose:hover { color: var(--forest-ink); background: rgba(255, 255, 255, .1); }
</style>