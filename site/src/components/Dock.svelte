<script lang="ts">
  /**
   * Mobile dock — an iOS-style floating pill. Four navigation tiles plus the
   * WhatsApp booking action, no text labels (the iPhone dock spells nothing
   * out; the icons and the green accent carry it). Hidden on desktop, where
   * the header carries the CTA.
   *
   * The booking href starts at the first rotation number with the booking
   * message pre-filled; data-wa lets the rotation script in layouts/Base.astro
   * swap to the next sales number on every click (owner, Nov 2026).
   */
  import { onMount } from 'svelte';
  import { waLink, waMessages } from '../data/site';

  let scrolled = $state(false);
  // Starts hidden: the dock must not cover the hero's call to action.
  let hidden = $state(true);
  let lastY = 0;

  const items = [
    { label: 'Beranda', href: '/', icon: 'home' },
    { label: 'Unit', href: '/#unit', icon: 'bed' },
    { label: 'Panorama 360°', href: '/#panorama', icon: 'compass' },
    { label: 'Simulasi KPR', href: '/simulasi-kpr/', icon: 'banknote' },
  ];

  const waHref = waLink(waMessages.booking);

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
      <a class="dock__item" href={item.href} aria-label={item.label}>
        <span class="dock__icon">
          {#if item.icon === 'home'}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2Z"/></svg>
          {:else if item.icon === 'bed'}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v-6h20v6M2 12V7M2 18h20M6 12V9h6v3M14 12V9h4a2 2 0 0 1 2 2v1"/></svg>
          {:else if item.icon === 'compass'}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
          {/if}
        </span>
      </a>
    {/each}

    <a
      class="dock__item dock__item--wa"
      href={waHref}
      target="_blank"
      rel="noopener"
      data-wa="dock"
      aria-label="Booking via WhatsApp"
    >
      <span class="dock__icon dock__icon--wa">
        <svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
      </span>
    </a>
  </div>
</nav>

<style>
  /*
    iOS dock anatomy: a floating frosted pill — not a full-width bar welded
    to the bottom edge. It hovers above the safe area, the glass is thick
    enough to read content behind it without fighting it, and the only
    affordance text is gone: tiles carry the meaning.
  */
  .dock {
    position: fixed;
    left: 50%;
    bottom: calc(14px + env(safe-area-inset-bottom));
    z-index: 40;
    padding: 10px 12px;
    border-radius: 30px;
    background: color-mix(in srgb, var(--white) 72%, transparent);
    backdrop-filter: saturate(1.8) blur(24px);
    -webkit-backdrop-filter: saturate(1.8) blur(24px);
    border: 1px solid rgb(255 255 255 / 0.65);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.75),
      0 18px 40px -12px rgb(1 42 51 / 0.35),
      0 4px 12px -4px rgb(1 42 51 / 0.18);
    transform: translateX(-50%);
    transition:
      transform var(--d-base) var(--ease-out),
      opacity var(--d-base) var(--ease-out);
  }

  .dock.is-hidden {
    /* the floating offset must travel with the hide animation */
    transform: translate(-50%, calc(100% + 28px));
    opacity: 0;
  }

  .dock__inner {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dock__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-decoration: none;
    color: var(--ink-600);
    -webkit-tap-highlight-color: transparent;
  }

  .dock__icon {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 15px;
    background: linear-gradient(180deg, #fff, var(--brand-050));
    border: 1px solid color-mix(in srgb, var(--brand-500) 16%, transparent);
    color: var(--brand-700);
    box-shadow: 0 3px 8px -3px rgb(1 42 51 / 0.16);
    transition: transform var(--d-fast) var(--ease-spring);
  }

  .dock__item:active .dock__icon {
    transform: scale(0.86);
  }

  /* the WhatsApp action reads as the system-highlighted app on the dock */
  .dock__item--wa .dock__icon {
    width: 50px;
    height: 50px;
    border-radius: 17px;
    background: linear-gradient(160deg, var(--wa-500), #128c7e);
    border-color: rgb(255 255 255 / 0.35);
    color: #fff;
    box-shadow:
      0 8px 20px -6px rgb(37 211 102 / 0.55),
      0 2px 6px rgb(1 42 51 / 0.15);
  }

  @media (min-width: 900px) {
    .dock {
      display: none;
    }
  }
</style>
