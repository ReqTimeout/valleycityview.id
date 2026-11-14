<script>
  import Icon from './Icon.svelte';
  let { icon = 'inbox', title = 'Belum ada data', note = '' } = $props();
</script>

<div class="empty">
  <Icon name={icon} size={30} />
  <h3>{title}</h3>
  {#if note}<p class="note">{note}</p>{/if}
</div>