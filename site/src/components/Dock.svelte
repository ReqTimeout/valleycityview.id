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
        <svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
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
