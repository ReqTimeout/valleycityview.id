<script>
  let { title = '', sub = '', i = 0, children, right } = $props();
</script>

<div class="card reveal" style="--i:{i}">
  {#if title}
    <div class="card-h">
      <h3>{title}</h3>
      {#if sub}<span class="sub">{sub}</span>{/if}
      {#if right}<span class="right">{@render right()}</span>{/if}
    </div>
  {/if}
  {@render children?.()}
</div>