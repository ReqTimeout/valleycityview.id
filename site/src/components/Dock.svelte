<script lang="ts">
  /**
   * Mobile dock — an iOS-style bottom bar. Five slots, the last one being the
   * WhatsApp action. Hidden on desktop where the header carries the CTA.
   */
  import { onMount } from 'svelte';

  let scrolled = $state(false);
  // Starts hidden: the dock must not cover the hero's call to action.
  let hidden = $state(true);
  let lastY = 0;

  const items = [
    { label: 'Beranda', href: '/', icon: 'home' },
    { label: 'Unit', href: '/#unit', icon: 'bed' },
    { label: '360°', href: '/#panorama', icon: 'compass' },
    { label: 'KPR', href: '/simulasi-kpr/', icon: 'banknote' },
  ];

  const waHref =
    'https://wa.me/6281188010326?text=' +
    encodeURIComponent(
      'Halo Valley Cityview! Saya tertarik booking unit tipe 45/72. Boleh info ketersediaan unit dan jadwal kunjungan ke lokasi?',
    );

  onMount(() => {
    const onScroll = () => {
      const y = window.scrollY;
      scrolled = y > 240;
      // Auto-hide when scrolling down, reveal when scrolling up.
      if (y > lastY && y > 420) hidden = true;
      else hidden = false;
      // The dock stays out of the way of the hero: on a phone it would cover
      // the primary "Amankan unit Anda" button in the first screen.
      if (y < 620) hidden = true;
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });
</script>

<nav
  class="dock"
  class:is-scrolled={scrolled}
  class:is-hidden={hidden}
  aria-label="Navigasi cepat"
>
  <div class="dock__inner">
    {#each items as item}
      <a class="dock__item" href={item.href}>
        <span class="dock__icon">
          {#if item.icon === 'home'}
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2Z"/></svg>
          {:else if item.icon === 'bed'}
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v-6h20v6M2 12V7M2 18h20M6 12V9h6v3M14 12V9h4a2 2 0 0 1 2 2v1"/></svg>
          {:else if item.icon === 'compass'}
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
          {/if}
        </span>
        <span class="dock__label">{item.label}</span>
      </a>
    {/each}

    <a
      class="dock__item dock__item--wa"
      href={waHref}
      target="_blank"
      rel="noopener"
      data-wa="dock"
    >
      <span class="dock__icon dock__icon--wa">
        <svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M20.5 3.5A10.4 10.4 0 0 0 3.2 16.1L2 22l6-1.2a10.4 10.4 0 0 0 12.5-17.3Zm0 18.1a8.9 8.9 0 0 1-4.5 1.2 8.9 8.9 0 0 1-4.5-1.2l-.3-.2-3.6.7.8-3.5-.2-.3a8.9 8.9 0 1 1 12.3-3.4Z"/><path d="M8.9 7.6c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.8 4.3 3.8 2.1.8 2.6.7 3.1.6.5 0 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.6-.3s-1.3-.7-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.8 6.8 0 0 1-2-1.2 7.5 7.5 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5V7.7Z"/></svg>
      </span>
      <span class="dock__label">Booking</span>
    </a>
  </div>
</nav>

<style>
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    padding: 0.5rem 0.6rem calc(0.5rem + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--white) 88%, transparent);
    backdrop-filter: saturate(1.6) blur(20px);
    -webkit-backdrop-filter: saturate(1.6) blur(20px);
    border-top: 1px solid var(--border);
    box-shadow: 0 -2px 14px rgb(1 42 51 / 0.08);
    transform: translateY(0);
    transition:
      transform var(--d-base) var(--ease-out),
      background-color var(--d-base) var(--ease-out);
  }

  .dock.is-hidden {
    transform: translateY(120%);
  }

  .dock__inner {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    align-items: end;
    gap: 0.15rem;
    max-width: 520px;
    margin-inline: auto;
  }

  .dock__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.4rem 0.15rem;
    text-decoration: none;
    color: var(--ink-600);
    -webkit-tap-highlight-color: transparent;
  }

  .dock__icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--brand-050);
    color: var(--brand-700);
    transition: transform var(--d-fast) var(--ease-spring);
  }

  .dock__item:active .dock__icon {
    transform: scale(0.88);
  }

  .dock__label {
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .dock__item--wa {
    color: var(--ink-900);
  }

  .dock__icon--wa {
    background: linear-gradient(160deg, var(--wa-500), var(--brand-500));
    color: #fff;
    box-shadow: 0 6px 16px rgb(37 211 102 / 0.38);
  }

  @media (min-width: 900px) {
    .dock {
      display: none;
    }
  }
</style>
