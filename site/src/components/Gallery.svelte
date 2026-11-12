<script lang="ts">
  /**
   * Project gallery with a lightbox. Hydrated with `client:visible` so the
   * JavaScript only arrives when the visitor actually reaches the gallery.
   */
  type Shot = {
    src: string;
    srcset?: string;
    alt: string;
    caption?: string;
    span?: 'wide' | 'tall' | 'normal';
  };

  let { shots = [] as Shot[] } = $props();

  let openIndex = $state<number | null>(null);
  // A native <dialog> gives the lightbox a focus trap, an inert background
  // and Escape-to-close for free — the hand-rolled div could not trap focus,
  // so keyboard users could tab straight out of the modal into the page
  // behind it. It also drops the manual body-lock and keydown listener, which
  // is JS the budget no longer has to carry.
  let dlg = $state<HTMLDialogElement | null>(null);

  function open(index: number) {
    openIndex = index;
    dlg?.showModal();
  }

  function close() {
    dlg?.close();
  }

  function onClose() {
    openIndex = null;
  }

  function step(delta: number) {
    if (openIndex === null) return;
    openIndex = (openIndex + delta + shots.length) % shots.length;
  }

  function onKey(event: KeyboardEvent) {
    // Escape is handled by the dialog itself; only the arrows are ours.
    if (event.key === 'ArrowRight') step(1);
    if (event.key === 'ArrowLeft') step(-1);
  }

  function onBackdropClick(event: MouseEvent) {
    // The dialog fills the viewport; anything that is not one of its children
    // is the dark margin around the figure, which should dismiss.
    if (event.target === dlg) close();
  }
</script>

<div class="gallery">
  {#each shots as shot, index}
    <button
      class="gallery__item gallery__item--{shot.span ?? 'normal'}"
      type="button"
      onclick={() => open(index)}
      aria-label="Perbesar: {shot.alt}"
    >
      <img
        src={shot.src}
        srcset={shot.srcset}
        sizes="(max-width: 640px) 50vw, (max-width: 1000px) 33vw, 25vw"
        alt={shot.alt}
        loading="lazy"
        decoding="async"
      />
      <span class="gallery__zoom" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/></svg>
      </span>
      {#if shot.caption}
        <span class="gallery__caption">{shot.caption}</span>
      {/if}
    </button>
  {/each}
</div>

<dialog
  class="lightbox"
  bind:this={dlg}
  aria-label="Pratinjau foto"
  onclose={onClose}
  onclick={onBackdropClick}
  onkeydown={onKey}
>
  {#if openIndex !== null}
    <button class="lightbox__close" type="button" onclick={close} aria-label="Tutup">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>

    <button class="lightbox__nav lightbox__nav--prev" type="button" onclick={() => step(-1)} aria-label="Foto sebelumnya">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
    </button>

    <figure class="lightbox__figure">
      <img src={shots[openIndex].src} alt={shots[openIndex].alt} />
      {#if shots[openIndex].caption}
        <figcaption>{shots[openIndex].caption}</figcaption>
      {/if}
    </figure>

    <button class="lightbox__nav lightbox__nav--next" type="button" onclick={() => step(1)} aria-label="Foto berikutnya">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </button>

    <p class="lightbox__count">{openIndex + 1} / {shots.length}</p>
  {/if}
</dialog>

<style>
  /*
    The grid is row-driven: every row has a fixed height, so the tiles line up
    and the mosaic never leaves a hole in the last row. The wide tiles span
    two columns and keep the same height as the others.
  */
  .gallery {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-auto-rows: 10.5rem;
    gap: 0.6rem;
  }

  .gallery__item {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-md);
    background: var(--brand-050);
    cursor: zoom-in;
  }

  .gallery__item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--d-slow) var(--ease-out);
  }

  .gallery__item:hover img {
    transform: scale(1.06);
  }

  .gallery__zoom {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--white) 88%, transparent);
    color: var(--brand-800);
    opacity: 0;
    transform: scale(0.8);
    transition:
      opacity var(--d-base) var(--ease-out),
      transform var(--d-base) var(--ease-spring);
  }

  .gallery__item:hover .gallery__zoom,
  .gallery__item:focus-visible .gallery__zoom {
    opacity: 1;
    transform: scale(1);
  }

  /* On a touch screen there is no hover, so the badge would never appear —
     the caption below already tells the visitor that the photo opens. */
  @media (hover: none) {
    .gallery__zoom {
      display: none;
    }
  }

  .gallery__caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 1.8rem 0.75rem 0.6rem;
    background: linear-gradient(to top, rgb(1 42 51 / 0.82), transparent);
    color: var(--white);
    font-size: var(--t-xs);
    font-weight: 600;
    text-align: left;
  }

  .lightbox {
    position: fixed;
    inset: 0;
    /* A native dialog is sized to its content and centred with margin:auto.
       We want it to fill the screen so the dark wash reads as a backdrop and
       a click in the empty margin falls on the dialog itself (dismiss). */
    margin: 0;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    z-index: 120;
    border: 0;
    padding: var(--s-4);
    display: grid;
    place-items: center;
    background: rgb(1 42 51 / 0.94);
    backdrop-filter: blur(6px);
    color: inherit;
  }

  /* display:grid would otherwise keep a closed dialog on screen — the [open]
     attribute is what the browser toggles on showModal()/close(). */
  .lightbox:not([open]) {
    display: none;
  }


  .lightbox[open] {
    animation: fade var(--d-base) var(--ease-out);
  }


  .lightbox::backdrop {
    background: transparent;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .lightbox__figure {
    margin: 0;
    max-width: min(1000px, 92vw);
    animation: pop var(--d-base) var(--ease-spring);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
  }

  .lightbox__figure img {
    max-height: 78vh;
    width: auto;
    border-radius: var(--r-md);
    background: transparent;
  }

  .lightbox__figure figcaption {
    color: var(--brand-100);
    font-size: var(--t-sm);
    text-align: center;
    margin-top: var(--s-3);
  }

  .lightbox__close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--white) 14%, transparent);
    color: var(--white);
    transition: background-color var(--d-fast) linear;
  }

  .lightbox__close:hover {
    background: color-mix(in srgb, var(--white) 26%, transparent);
  }

  .lightbox__nav {
    position: absolute;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--white) 14%, transparent);
    color: var(--white);
    transition: background-color var(--d-fast) linear;
  }

  .lightbox__nav:hover {
    background: color-mix(in srgb, var(--white) 26%, transparent);
  }

  .lightbox__nav--prev {
    left: 0.75rem;
  }

  .lightbox__nav--next {
    right: 0.75rem;
  }

  .lightbox__count {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    translate: -50% 0;
    color: var(--brand-100);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
  }

  @media (min-width: 700px) {
    .gallery {
      grid-template-columns: repeat(3, 1fr);
      grid-auto-rows: 12rem;
      gap: 0.85rem;
    }
  }

  @media (min-width: 1000px) {
    .gallery {
      grid-template-columns: repeat(4, 1fr);
      grid-auto-rows: 13.5rem;
    }

    .gallery__item--wide {
      grid-column: span 2;
    }
  }
</style>
