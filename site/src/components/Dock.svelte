<script lang="ts">
  /**
   * Mobile dock — a premium tab bar with labels and a raised WhatsApp
   * action in the middle (the pattern every Indonesian marketplace uses:
   * four destinations + one glowing call-to-action). Owner 12 Nov 2026:
   * the icon-only pill was too small and unlabeled — "jelek sekali".
   * Hidden on desktop, where the header carries the CTA.
   *
   * The booking href starts at the first rotation number with the booking
   * message pre-filled; data-wa lets the rotation script in layouts/Base.astro
   * swap to the next sales number on every click.
   */
  import { onMount } from 'svelte';
  import { waLink, waMessages } from '../data/site';

  let scrolled = $state(false);
  // Starts hidden: the dock must not cover the hero's call to action.
  let hidden = $state(true);
  let lastY = 0;

  // Slots around the centre action. Blog replaces 360° because the mobile
  // hamburger is gone — the dock is now the only chrome navigation, and the
  // panorama is one scroll away on the homepage anyway.
  const items = [
    { label: 'Beranda', href: '/', icon: 'home' },
    { label: 'Unit', href: '/#unit', icon: 'bed' },
    { label: 'Booking', href: 'wa', icon: 'wa' },
    { label: 'KPR', href: '/simulasi-kpr/', icon: 'banknote' },
    { label: 'Blog', href: '/blog/', icon: 'blog' },
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
      {#if item.icon === 'wa'}
        <a
          class="dock__item dock__item--wa"
          href={waHref}
          target="_blank"
          rel="noopener"
          data-wa="dock"
          aria-label="Booking via WhatsApp"
        >
          <span class="dock__fab">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
          </span>
          <span class="dock__label dock__label--wa">{item.label}</span>
        </a>
      {:else}
        <a class="dock__item" href={item.href}>
          <span class="dock__icon">
            {#if item.icon === 'home'}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2Z"/></svg>
            {:else if item.icon === 'bed'}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v-6h20v6M2 12V7M2 18h20M6 12V9h6v3M14 12V9h4a2 2 0 0 1 2 2v1"/></svg>
            {:else if item.icon === 'blog'}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2Z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8Z"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>
            {/if}
          </span>
          <span class="dock__label">{item.label}</span>
        </a>
      {/if}
    {/each}
  </div>
</nav>

<style>
  /*
    iOS glass + marketplace centre-action: a floating frosted pill with
    labelled tiles, and the WhatsApp booking button lifted out of the bar
    as a glowing green FAB with a slow radar ring. Big enough to hit with
    a thumb without aiming ("jangan kecil tapi pas").
  */
  .dock {
    position: fixed;
    left: 50%;
    bottom: calc(12px + env(safe-area-inset-bottom));
    z-index: 40;
    padding: 10px 12px 8px;
    border-radius: 26px;
    background: color-mix(in srgb, var(--white) 82%, transparent);
    backdrop-filter: saturate(1.8) blur(24px);
    -webkit-backdrop-filter: saturate(1.8) blur(24px);
    border: 1px solid rgb(255 255 255 / 0.7);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.8),
      0 18px 40px -12px rgb(1 42 51 / 0.35),
      0 4px 12px -4px rgb(1 42 51 / 0.18);
    transform: translateX(-50%);
    transition:
      transform var(--d-base) var(--ease-out),
      opacity var(--d-base) var(--ease-out);
  }

  .dock.is-hidden {
    transform: translate(-50%, calc(100% + 34px));
    opacity: 0;
  }

  .dock__inner {
    display: flex;
    align-items: flex-end;
    gap: 4px;
  }

  .dock__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    /* 4×56 + 66 + 4 gap + 24 padding ≈ 320px — di 390px masih ada ±35px
       kiri-kanan; versi 64/78 melebar sampai 380 dan menempel tepi. */
    width: 56px;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }

  .dock__icon {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: linear-gradient(180deg, #fff, var(--brand-050));
    border: 1px solid color-mix(in srgb, var(--brand-500) 16%, transparent);
    color: var(--brand-700);
    box-shadow: 0 3px 8px -3px rgb(1 42 51 / 0.16);
    transition: transform var(--d-fast) var(--ease-spring);
  }

  .dock__item:active .dock__icon {
    transform: scale(0.86);
  }

  .dock__label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--ink-600);
  }

  /* --- the centre WhatsApp action ---------------- */
  .dock__item--wa {
    width: 66px;
    gap: 2px;
  }

  .dock__fab {
    position: relative;
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    border-radius: 18px;
    background: linear-gradient(160deg, var(--wa-500), #128c7e);
    border: 2.5px solid #fff;
    color: #fff;
    box-shadow:
      0 10px 24px -6px rgb(37 211 102 / 0.55),
      0 2px 6px rgb(1 42 51 / 0.18);
    transform: translateY(-14px);
    transition: transform var(--d-fast) var(--ease-spring);
  }

  /* radar ring: box-shadow spread + opacity only — no movement, so it is
     safe to keep even under Reduce Motion (re-enabled below) */
  .dock__fab::before {
    content: '';
    position: absolute;
    inset: -2.5px;
    border-radius: inherit;
    animation: waRing 2.4s var(--ease-out, ease-out) infinite;
  }

  @keyframes waRing {
    0% { box-shadow: 0 0 0 0 rgb(37 211 102 / 0.5); opacity: 1; }
    70% { box-shadow: 0 0 0 14px rgb(37 211 102 / 0); opacity: 0.55; }
    100% { box-shadow: 0 0 0 0 rgb(37 211 102 / 0); opacity: 0; }
  }

  .dock__item--wa:active .dock__fab {
    transform: translateY(-14px) scale(0.9);
  }

  .dock__label--wa {
    margin-top: -6px;
    color: var(--brand-700);
    font-weight: 700;
  }

  @media (prefers-reduced-motion: reduce) {
    /* kill-switch global memangkas durasi; ring hanya box-shadow/opacity —
       aman untuk vestibular, jadi dihidupkan lagi */
    .dock__fab::before {
      animation: waRing 2.4s ease-out infinite !important;
      animation-duration: 2.4s !important;
      animation-iteration-count: infinite !important;
    }
  }

  @media (min-width: 900px) {
    .dock {
      display: none;
    }
  }
</style>
