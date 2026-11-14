<script>
  import Icon from './Icon.svelte';
  import { router } from '../lib/state.svelte.js';
  const DOCK = [
    { href: '/', label: 'Overview', icon: 'home' },
    { href: '/queue', label: 'Antrean', icon: 'list' },
    { href: '/content', label: 'Konten', icon: 'file' },
    { href: '/runs', label: 'Runs', icon: 'play' },
    { href: '/health', label: 'Health', icon: 'activity' },
  ];
</script>

<nav class="dock" aria-label="Navigasi utama">
  {#each DOCK as n}
    <a href={n.href} aria-current={router.path === n.href ? 'page' : undefined} onclick={(e) => { e.preventDefault(); router.go(n.href); }}>
      <Icon name={n.icon} size={20} />{n.label}
    </a>
  {/each}
</nav>