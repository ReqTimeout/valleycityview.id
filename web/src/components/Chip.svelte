<script>
  import { chipKind } from '../lib/format.js';
  let { value, label, kind } = $props();
  const k = $derived(kind || chipKind(value));
</script>

<span class="chip {k}">{label ?? value}</span>