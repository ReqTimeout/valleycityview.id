# Decision Log — Valley Cityview Rebuild

Format: **Decision → Context → Rationale → Rejected alternatives → Status**

---

## D-01 — Target platform: Cloudflare Pages (static), WordPress retired

- **Decision:** Rebuild as a static site deployed to Cloudflare Pages. No PHP runtime, no MySQL.
- **Context:** User explicitly rejected keeping WordPress: *"saya mau ubah ke sveltekit dan astro di cloudflare page bukan pake wp"*.
- **Rationale:** Content is fundamentally static (5 pages, ~71 posts, 6 landings, 1 form). CF Pages gives a free global edge CDN — material for an Indonesian mobile-4G audience. Removes WP core + 23 plugins of attack surface and host cost.
- **Rejected:** WP headless with CF in front (still needs PHP host + DB; no perf win); keeping Elementor (Elementor Pro is a paid builder — it cannot run on CF Pages).
- **Status:** ✅ Locked

---

## D-02 — Framework: Astro 5 core + Svelte islands

- **Decision:** Astro as the static core. Svelte (SvelteKit component model) for interactive
  islands only — KPR simulator, mobile dock menu, scroll-reveal micro-animations.
- **Context:** User named "sveltekit dan astro". Read as: Svelte-family interactivity + Astro
  content handling, not WordPress.
- **Rationale:**
  - Astro **content collections** map 1:1 onto the WP post export (MDX + typed frontmatter).
  - ~0 KB JS baseline → far better LCP on low-end Android / 4G than a hydrating SPA.
  - Svelte islands give the micro-animation/interaction quality the user wants *without*
    shipping a runtime to every page.
- **Rejected:**
  - **Pure SvelteKit** — viable, but adds an SSR adapter + hydration tax for a site that is
    ~95% static content. Justified only if a real app is later built (agent portal / CRM /
    live unit inventory) — see D-03.
  - **Astro + React** — same architecture, but Svelte's smaller runtime suits the island set.
- **Status:** ✅ Locked

---

## D-03 — Keep WordPress as editing backend *only* during transition (then retire)

- **Decision:** Export WP content to MDX/JSON now. Keep the WP instance reachable read-only
  for the team's reference during the build; it is **not** part of the new runtime.
- **Rationale:** The team must be able to see and copy content. WordPress can still be edited
  manually and re-exported via the pipeline if needed — but the deployed site never queries it.
- **Rejected:** Running WP as a headless CMS with CF Pages pulling at build time — adds a
  build-time dependency on a live host and slows every deploy.
- **Status:** 🟡 Open — decide with user whether to retire WP entirely or keep it as an
  internal editing tool.

---

## D-04 — Form handling: Cloudflare Pages Function, not a third-party form service

- **Decision:** `functions/api/booking.ts` — a Pages Function receives the booking POST,
  validates, and forwards to email + stores to KV/D1, then fires `generate_lead`.
- **Context:** SureForms ID 1058 currently writes to the WP DB — that storage disappears with WP.
- **Rationale:** Keeps lead capture on-stack (no third-party data processor, no extra consent
  surface), matches CF's native model, and lets the function do server-side validation +
  honeypot + rate limiting.
- **Rejected:** Formspree/Netlify Forms (third-party processor, data leaves the domain);
  Google Sheets via Apps Script (slow, fragile, no validation).
- **Status:** 🟡 Open — needs the destination email / CRM confirmed by user.

---

## D-05 — Price of record: Rp 3.871.000/bulan

- **Decision:** Rp 599.000.000 KPR / **Rp 3.871.000 per bulan** / booking fee Rp 5.000.000.
  The homepage figure "Rp 1.300.000 All In" is deleted, not corrected in place.
- **Rationale:** Verified by annuity math — Rp 3.871.000/mo over 240 months on Rp 599 jt
  ⇒ ≈ 4.75 %/yr, fully consistent. Rp 1,3 jt would imply ≈ Rp 200 jt over 20 years at 0 %.
  All 71 blog posts already use Rp 3.871.000, so the homepage was the outlier.
- **Rejected:** Keeping both with a "mulai dari" qualifier — muddies a headline price and
  re-introduces the exact contradiction we are removing.
- **Status:** 🟡 Open — user must confirm before this ships publicly.

---

## D-06 — Brand identity: teal `#01505d` + yellow `#fee203`

- **Decision:** Adopt the colour pair already used by the newer Tailwind landing pages
  (`agent.html`, `skagent.html`) as the single brand system. Retire the Elementor
  `#2c3e50 / #3498db / #e67e22` palette.
- **Rationale:** Two brand systems currently coexist on one domain. The teal/yellow pair is
  newer, already shipped, higher-contrast, and reads "land + sunlight" for a valley project.
- **Rejected:** Keeping the Elementor blue — it is the generic default of the imported
  template kit, i.e. exactly the "generic AI landing page" look to escape.
- **Status:** ✅ Locked (design tokens live in `site/src/styles/global.css`)

---

## D-07 — Content pruning: keep 71 posts initially, curate after launch

- **Decision:** Migrate all 71 posts in the first pass so nothing is lost, but:
  - every post gets a hand-written meta description,
  - the 9 near-duplicate pairs are flagged in the content map for merge/canonical,
  - a `status` field in frontmatter (`publish` / `review` / `draft`) drives the build.
- **Rationale:** Pruning before the user has read them would destroy potentially useful
  content and is hard to reverse. Flagging + frontmatter makes the decision reversible
  and visible.
- **Rejected:** Deleting the competitor-comparison posts outright (some genuinely rank);
  rewriting all 71 before the new site is live (no feedback loop yet).
- **Status:** 🟡 Open — user to review the flag list.

---

## D-08 — Media: re-encode to WebP, strip the dead kit's assets

- **Decision:** All imagery converted to WebP via `sharp`, sized to real display widths
  (hero 1080w @ ≤180 KB, cards 800w @ ≤90 KB, thumbs 400w). The 86 MB `.mov` and the entire
  Lushen cottage-kit image set are **not** migrated.
- **Rationale:** 349 MB of uploads → target < 20 MB. Current hero alone is 2.7 MB PNG.
- **Rejected:** Shipping originals and relying on Astro's build-time optimisation only —
  Astro `sharp` cannot recover the 5.6 MB PNG's quality loss, and the source PNGs are
  already over-compressed/uncompressed PNG.
- **Status:** ✅ Locked

---

## D-09 — URL structure: clean, no `.html` suffix

- **Decision:** `valleycity.id/` · `/blog/` · `/blog/<slug>/` · `/privacy/` · `/thank-you/`
  plus landing pages at `/simulasi-kpr/`, `/nup/`, `/sale/`, `/agent/`, `/agent/terms/`.
- **Rationale:** Current `/%postname%.html` is non-standard. A 301 map is generated
  (see `02-content-map.md`) so no ranking is lost.
- **Status:** ✅ Locked

---

## D-10 — Content format: plain Markdown (`.md`), not MDX

- **Decision:** The blog collection stores plain `.md` with raw HTML in the body.
  No `@astrojs/mdx` integration.
- **Context:** The exporter produces HTML-heavy Elementor output. MDX parses the body as JSX,
  so any unclosed `<li>`/`<p>` in the source becomes a hard build error
  ("Expected a closing tag for `<li>`"). Plain Markdown passes raw HTML straight through.
- **Rationale:** The posts are legacy HTML, not components. The moment we want JSX in a post
  body, we can add MDX back for that collection only. Typed frontmatter works the same either way.
- **Rejected:**
  - **Keep MDX and hand-fix every post** — 71 posts × unknown number of unbalanced tags.
  - **Sanitise the HTML down to a strict subset** — would throw away tables, figures, and
    the price-list blocks that carry real information.
- **Status:** ✅ Locked (Astro 5 `glob()` loader, pattern `**/*.md`)

---

## D-11 — Media naming: the bare path is the largest variant

- **Decision:** `/media/x/y.webp` is a real file (the largest variant we generate).
  The responsive siblings are `/media/x/y-400.webp`, `-800`, `-1200`, `-1600`.
  The `srcset` lists the bare path for the widest entry.
- **Context:** The first build referenced a bare `/media/…/1-3.webp` that was never written —
  the optimiser only wrote `-400/-800/…` files. 644 images were broken.
- **Rationale:** Every reference resolves with or without a `srcset`, and we do not ship a
  byte-identical duplicate of the largest image. public/media: 52 MB → 36 MB.
- **Rejected:** Writing the bare path as a copy of the largest (17 MB of duplicates);
  writing only the sized variants (bare references break again).
- **Status:** ✅ Locked

---

## D-12 — The WordPress privacy and thank-you pages are archived, not migrated

- **Decision:** `memory/legacy-pages/*.md` keeps the imported WP versions for the record.
  The live pages are hand-written (`src/pages/privacy.astro`, `src/pages/thank-you.astro`).
- **Context:** The WP privacy page was the unmodified WordPress template — it still had
  "Teks yang disarankan:" placeholders and no company details at all.
- **Rationale:** A privacy policy with unfilled placeholders is worse than no page. The
  hand-written version names the developer, the address, the data collected, and how to
  request deletion — which is what Indonesian law (UU PDP) actually asks for.
- **Rejected:** Shipping the WP template (placeholder text, wrong entity);
  migrating it as-is into the content collection (nothing rendered it anyway).
- **Status:** ✅ Locked

---

## D-13 — Verification is part of the pipeline, not an afterthought

- **Decision:** Two checkers run on every build and both must pass:
  `tools/check_refs.py` (every local reference resolves) and `tools/check_copy.py`
  (no garbled / glued / foreign-script copy). `tools/migrate.sh` chains the whole thing.
- **Context:** A green build said nothing about correctness — the first successful build
  still had 1310 broken references. The bugs were only visible by resolving every
  reference against the actual output.
- **Rationale:** A migration this size cannot be eyeballed. Making the check part of the
  command means regressions surface in seconds, not at review time.
- **Rejected:** Manual spot-checking (does not scale to 5114 references);
  a test framework (the checks are about output, not units).
- **Status:** ✅ Locked

---

## D-14 — The old WordPress install is a reference, not a dependency

- **Decision:** Nothing in the new site reads from WordPress at build time or at runtime.
  The backup stays in the repo as the archival source; the exported collections are the
  only input to the build.
- **Rationale:** Keeps the CF build hermetic (no database, no network dependency, no
  chance of the old site going down mid-deploy) and lets us delete the WP host as soon as
  the new site is live.
- **Status:** ✅ Locked (see D-03 for whether the WP install is retired entirely)

