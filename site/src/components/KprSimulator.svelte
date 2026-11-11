<script lang="ts">
  /**
   * KPR simulator — the same annuity maths that produces the Rp 3.871.000
   * headline figure, so the number on the page is always reproducible.
   */
  const rupiah = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });

  let price = $state(599_000_000);
  let downPaymentPct = $state(0);
  let years = $state(20);
  let ratePct = $state(4.75);

  const monthly = $derived.by(() => {
    const principal = price * (1 - downPaymentPct / 100);
    const n = years * 12;
    const r = ratePct / 100 / 12;
    if (principal <= 0 || n <= 0) return 0;
    if (r === 0) return principal / n;
    const growth = Math.pow(1 + r, n);
    return (principal * r * growth) / (growth - 1);
  });

  const downPayment = $derived(price * (downPaymentPct / 100));
  const totalPaid = $derived(monthly * years * 12 + downPayment);
  const totalInterest = $derived(totalPaid - price);

  /** Matches the headline figure: 20 yr, 4.75 %, no down payment. */
  const matchesHeadline = $derived(
    downPaymentPct === 0 &&
    years === 20 &&
    ratePct === 4.75 &&
    Math.abs(monthly - 3_871_000) < 15_000,
  );

  const waHref = $derived(
    'https://wa.me/6281188010326?text=' +
      encodeURIComponent(
        `Halo Valley Cityview! Saya mau tanya KPR untuk tipe 45/72. ` +
          `Dengan ${rupiah.format(monthly)} per bulan selama ${years} tahun, ` +
          `apakah masih tersedia unitnya?`,
      ),
  );

  function report() {
    const w = window as unknown as { vcv?: { track: (n: string, p: object) => void } };
    w.vcv?.track('kpr_simulation', {
      event_category: 'engagement',
      value: Math.round(monthly),
      currency: 'IDR',
      tenor_years: years,
      down_payment_pct: downPaymentPct,
    });
  }
</script>

<div class="kpr" id="kpr-simulator">
  <div class="kpr__controls">
    <label class="kpr__field">
      <span class="kpr__label">
        Harga KPR
        <em>Rp {Math.round(price / 1_000_000)} juta</em>
      </span>
      <input
        type="range"
        min="100000000"
        max="1500000000"
        step="1000000"
        bind:value={price}
        oninput={report}
      />
      <output>{rupiah.format(price)}</output>
    </label>

    <label class="kpr__field">
      <span class="kpr__label">
        Uang muka
        <em>{downPaymentPct === 0 ? 'Tanpa DP' : `${downPaymentPct}%`}</em>
      </span>
      <input
        type="range"
        min="0"
        max="50"
        step="5"
        bind:value={downPaymentPct}
        oninput={report}
      />
      <output>{rupiah.format(downPayment)}</output>
    </label>

    <label class="kpr__field">
      <span class="kpr__label">
        Tenor
        <em>{years} tahun</em>
      </span>
      <input
        type="range"
        min="10"
        max="30"
        step="5"
        bind:value={years}
        oninput={report}
      />
      <output>{years * 12} bulan</output>
    </label>

    <label class="kpr__field">
      <span class="kpr__label">
        Suku bunga
        <em>{ratePct}% / tahun</em>
      </span>
      <input
        type="range"
        min="3.5"
        max="8"
        step="0.25"
        bind:value={ratePct}
        oninput={report}
      />
      <output>{ratePct}%</output>
    </label>
  </div>

  <div class="kpr__result" aria-live="polite">
    <p class="kpr__result-label">Estimasi cicilan per bulan</p>
    <p class="kpr__result-value">{rupiah.format(monthly)}</p>

    {#if matchesHeadline}
      <p class="kpr__badge">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg>
        Ini angka yang kami tawarkan
      </p>
    {/if}

    <dl class="kpr__breakdown">
      <div>
        <dt>Total dibayar</dt>
        <dd>{rupiah.format(totalPaid)}</dd>
      </div>
      <div>
        <dt>Total bunga</dt>
        <dd>{rupiah.format(totalInterest)}</dd>
      </div>
    </dl>

    <a class="kpr__cta" href={waHref} target="_blank" rel="noopener" data-wa="kpr-simulator">
      Tanya unit ini ke WhatsApp
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>

    <p class="kpr__note">
      Simulasi ini memakai metode bunga cicilan tetap (annuity) dengan
      perhitungan yang sama seperti angka yang kami tawarkan. Ketentuan akhir
      tetap mengikuti appraisal bank dan salesperson kami konfirmasi langsung.
    </p>
  </div>
</div>

<style>
  .kpr {
    display: grid;
    gap: var(--s-5);
  }

  .kpr__controls {
    display: grid;
    gap: var(--s-4);
  }

  .kpr__field {
    display: grid;
    gap: 0.4rem;
  }

  .kpr__label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--ink-700);
  }

  .kpr__label em {
    font-style: normal;
    font-weight: 700;
    color: var(--brand-700);
  }

  .kpr__field output {
    font-size: var(--t-xs);
    color: var(--ink-500);
    font-variant-numeric: tabular-nums;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--sand-200);
    outline: none;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--brand-700);
    border: 3px solid var(--white);
    box-shadow: var(--shadow-sm);
    cursor: grab;
    transition: transform var(--d-fast) var(--ease-spring);
  }

  input[type='range']::-webkit-slider-thumb:active {
    transform: scale(1.15);
  }

  input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--brand-700);
    border: 3px solid var(--white);
    cursor: grab;
  }

  .kpr__result {
    background: var(--brand-900);
    color: var(--sand-100);
    border-radius: var(--r-lg);
    padding: var(--s-5);
    display: grid;
    gap: var(--s-3);
  }

  .kpr__result-label {
    margin: 0;
    font-size: var(--t-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--brand-300);
  }

  .kpr__result-value {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--t-3xl);
    font-weight: 700;
    line-height: 1.05;
    color: var(--accent-500);
    font-variant-numeric: tabular-nums;
  }

  .kpr__badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: var(--t-xs);
    font-weight: 700;
    color: var(--accent-500);
    background: color-mix(in srgb, var(--accent-500) 16%, transparent);
    padding: 0.3rem 0.6rem;
    border-radius: var(--r-full);
    justify-self: start;
  }

  .kpr__breakdown {
    margin: 0;
    display: grid;
    gap: 0.4rem;
    border-top: 1px solid color-mix(in srgb, var(--white) 14%, transparent);
    padding-top: var(--s-3);
  }

  .kpr__breakdown > div {
    display: flex;
    justify-content: space-between;
    font-size: var(--t-xs);
    gap: var(--s-3);
  }

  .kpr__breakdown dt {
    color: color-mix(in srgb, var(--brand-100) 70%, transparent);
  }

  .kpr__breakdown dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .kpr__cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--accent-500);
    color: var(--ink-900);
    padding: 0.8rem 1.1rem;
    border-radius: var(--r-full);
    font-weight: 700;
    font-size: var(--t-sm);
    text-decoration: none;
    transition:
      background-color var(--d-fast) linear,
      transform var(--d-fast) var(--ease-spring);
  }

  .kpr__cta:hover {
    background: var(--accent-400);
    color: var(--ink-900);
    transform: translateY(-2px);
  }

  .kpr__note {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: color-mix(in srgb, var(--brand-100) 62%, transparent);
  }

  @media (min-width: 720px) {
    .kpr {
      grid-template-columns: 1.15fr 1fr;
      gap: var(--s-6);
      align-items: start;
    }

    .kpr__result {
      position: sticky;
      top: calc(var(--header-h) + 1rem);
    }
  }
</style>
