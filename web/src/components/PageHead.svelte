<script>
  let { title, sub = '', children } = $props();
</script>

<div class="page-head reveal">
  <div>
    <h1>{title}</h1>
    {#if sub}<div class="sub">{sub}</div>{/if}
  </div>
  {#if children}<div class="actions">{@render children()}</div>{/if}
</div>