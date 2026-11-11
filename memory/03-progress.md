# Progress Log — Valley Cityview Rebuild

> Updated after **every** step. Newest entry at the bottom.
> Status: ⬜ not started · 🟡 in progress · ✅ done · ⛔ blocked · ❌ dropped

---

## Step 0 — Audit (COMPLETE)

- ⬜ → ✅ Parsed full WP backup: 1051 `wp_posts`, 3456 `wp_options`, all `wp_postmeta`.
- ⬜ → ✅ Mapped Elementor structure of homepage (page 83), header (203), footer (374), post template (542).
- ⬜ → ✅ Audited 155 attachments + 349 MB uploads; measured every September image.
- ⬜ → ✅ Audited 6 static landing pages, tracking stack, form, permalinks.
- ⬜ → ✅ Verified the Rp 1,3 jt vs Rp 3,8 jt contradiction by annuity math → **Rp 3.871.000 is correct**.
- ⬜ → ✅ Detected 9 near-duplicate post pairs (worst 0.97 Jaccard).
- ✅ Findings written to `00-audit.md`.

---

## Step 1 — Planning (COMPLETE)

- ✅ Stack decision: **Astro 5 + Svelte islands → Cloudflare Pages** (D-01, D-02).
- ✅ Decision log written to `01-decisions.md`.
- ✅ Content map generated to `02-content-map.md`.
- ✅ Task checklist in `04-todo.md`.

---

## Step 2 — Scaffold Astro project (COMPLETE)

- ✅ Created `site/` — Astro 5, `@astrojs/svelte` 7, Svelte 5, `sharp`, `@astrojs/sitemap`.
- ✅ `npm install` — 377 packages, no errors.
- ✅ `package.json` scripts: `dev` / `build` / `preview` / `check` / `media` / `redirects`.
- ✅ Decision: **no CF adapter** — site is fully static; the booking form is a root-level
  `functions/api/booking.ts` (Cloudflare Pages Functions), which CF picks up alongside `dist/`.
  This avoids the SSR adapter entirely.

---

## Step 3 — Migration tooling (COMPLETE)

- ✅ `tools/wp_sql.py` — quote-aware mysqldump reader (no MySQL server needed).
  Reads the 84 MB `.sql.gz` directly.
- ✅ `tools/wp_html.py` — WP HTML → clean semantic HTML. Strips Gutenberg comments,
  Elementor classes, inline Elementor SVG icons, lightbox `data-e-action-hash` attrs,
  `data-start`/`data-end`, presentational table attrs, `Terpopuler` related-post widget,
  leading breadcrumb, duplicate H1 + title-H2 echo, self-linking featured images,
  bare YouTube URLs, and the agency's keyword-link block (→ clean CTA aside).
- ✅ `tools/export_content.py` — exports:
  - `site/src/collections/blog/*.md` — **71 posts**
  - `memory/legacy-pages/*.md` — the 2 WP pages, archived (superseded by hand-written pages)
  - `memory/legacy-landings/*.html` — 6 legacy landing pages (reference)
  - `site/src/data/media-needed.json` — 193 images to optimise
  - `site/src/data/media-manifest.json` / `media-source-map.json` — runtime lookup tables
  - `site/src/data/redirects.json` — old → new URL map
  - `site/src/data/blog-index.json`
  - `memory/02-content-map.md` — human-readable migration map

### Cleaning verification (all 71 posts scanned)

| Junk | Result |
|---|---|
| `<h1>` leftover | 0 |
| Inline Elementor SVG | 0 |
| `data-e-action-hash` (lightbox) | 0 |
| `Terpopuler` widget | 0 |
| Breadcrumb | 4 files (minor) |
| `border=`/`cellpadding=` on tables | 0 |
| Spanish typo `Limbiento` | 0 → fixed to `Lingkuangan` |
| `data-start`/`data-end` | 0 |
| Absolute `http://valleycity.id` | 0 |
| `[sureforms]` shortcode | 0 (→ `<!--FORM:BOOKING-->` marker) |
| `elementor-*` classes | 0 |
| Unresolved `/wp-content/uploads` refs | **0** |

- ✅ Fixed meta descriptions: generated from the first real paragraph, truncated on a
  word boundary at 160 chars (was cutting mid-word).

---

## Step 4 — Media optimisation (COMPLETE)

- ✅ `site/scripts/optimize-media.mjs` — `sharp` → WebP at widths 400/800/1200/1600 (+ original).
- ✅ 193/193 images processed. **127.6 MB source → 34.7 MB output** (public/media = 36 MB).
- ✅ Hero `6.png`: 2.7 MB PNG → 59.5 KB WebP.
- ✅ Responsive `srcset` generated per image; a rehype plugin injects `srcset`/`width`/`height`/
  `loading`/`decoding` into every `<img>` in a blog body.
- ✅ Stale-file pruning so the deploy only carries what is actually referenced.

---

## Step 5 — Design system & core layout (COMPLETE)

- ✅ `site/src/styles/global.css` — the "Lembah" design system.
  Tokens `--brand-900…--brand-700` (teal `#01505d`), `--accent-500` (`#fee203`), `--sand-50`,
  `--ink-900`; Fraunces (display) + Plus Jakarta Sans (text); fluid `clamp()` type scale;
  motion easings; `.contour` CSS-art motif; `[data-reveal]` scroll reveals with
  `prefers-reduced-motion` fallback.
- ✅ Components: `Header`, `Footer`, `Seo`, `Tracking`, `BookingForm`, `Picture`, `Icon`,
  `Dock.svelte` (iOS-style mobile dock), `KprSimulator.svelte`, `Gallery.svelte`.
- ✅ Layouts: `Base.astro`, `Landing.astro` (minimal ad-campaign shell, noindex).

---

## Step 6 — Pages (COMPLETE)

- ✅ `index.astro` — hero, proof bar, tentang, unit + denah, panorama 360, galeri, lokasi,
  KPR, FAQ, booking, plus Residence/Product/LocalBusiness/FAQPage JSON-LD.
- ✅ `blog/index.astro`, `blog/[slug].astro` — related posts, share row, aside price card.
- ✅ `privacy.astro`, `thank-you.astro` — hand-written Indonesian (the WP versions were the
  unmodified WordPress template with "Teks yang disarankan" placeholders).
- ✅ `simulasi-kpr`, `nup`, `sale`, `agent/`, `agent/terms`, `agent/alt`.
- ✅ `functions/api/booking.ts` — Pages Function: honeypot, phone validation, KV rate limit
  (6/h per IP), KV archive (90-day TTL), webhook + Resend email.
- ✅ Tracking: GA4, GTM, Meta Pixel, Stape, `whatsapp_click` event.

---

## Step 7 — Content integrity pass (COMPLETE)

> The first successful build still shipped **644 broken images** and **666 broken links**.
> A reference checker was written to find them, then the pipeline was rebuilt around it.

- ✅ `tools/check_refs.py` — walks `site/dist/**/*.html`, resolves every `src`/`href`/`srcset`
  against the build output.
- ✅ `tools/check_copy.py` — Indonesian copy linter (foreign script, glued words, camel-glue,
  spacing, English leftovers). Extended to also lint the imported collections.
- ✅ `wp_html.rewrite_links()` — maps old WP permalinks (`/<slug>.html`, `/<slug>`, `/blog`)
  onto the new `/blog/<slug>/` routes. External URLs and fragments untouched.
- ✅ `wp_html.strip_document_shell()` — **13 posts carried a pasted `<html><head>` shell**
  whose canonical/og:url pointed at the old permalink. That was the root cause of most of
  the 666 broken links.
- ✅ Malformed `data-="…"` attributes (Elementor dynamic-tag leftovers, 1365 occurrences)
  are now stripped.
- ✅ Fixed the shared `menenangkanSejak` → `menenangkan sejak` typo in all 71 posts.
- ✅ Media naming fixed: the bare `/media/x/y.webp` path **is** the largest variant, the
  responsive siblings are `-400/-800/-1200/-1600.webp`. No duplicate bytes shipped.
- ✅ `tools/migrate.sh` — one command runs scan → media → export → build → verify.

### Verification result

```
pages checked      : 80
references checked : 5114
OK — every local reference resolves.

0 issue(s) across 93 file(s)      ← copy linter
```

Build: **80 pages, 45 MB dist**, JS payload ≈ 32 KB (Svelte runtime) + 4–8 KB per island,
CSS 8–20 KB per page.

---

## Step 8 — Browser verification (TODO)

- ⬜ `astro preview` → walk the site on mobile (390 px) and desktop (1440 px).
- ⬜ Verify: sticky header, mobile dock auto-hide, gallery lightbox, KPR simulator maths,
  booking form POST, 360° embed, scroll reveal, reduced-motion.
- ⬜ Check every landing page renders its campaign copy.

---

## Step 9 — Cloudflare Pages deploy (BLOCKED — awaiting account)

- ⬜ Create the Pages project, connect the repo.
- ⬜ Build command `npm run build`, output `dist`, functions directory `functions/`.
- ⬜ Set the env vars the booking function needs (see D-04).
- ⬜ Custom domain + DNS + SSL, then verify the 301 map and analytics IDs.

---

## Step 8 — Visual review → STOPPED, direction reset

The browser review found real defects, and they were worth fixing:

- ✅ The scoped-CSS bug: Astro does not propagate a parent's scope to a child
  component's root element, so **every** `<Picture>` image fell back to its
  intrinsic size. The header logo rendered 425×213 px (the header was 214 px
  tall), the hero photo was not cropped, the card images had no `object-fit`.
  Fixed by moving all image rules into a global `src/styles/media.css`.
- ✅ `og:image` pointed at `/media/curated/hero-1080.webp`, which never existed.
- ✅ The KPR price slider snapped Rp 599 juta → Rp 600 juta (the step grid did
  not contain the advertised price), so the simulator could never show the
  advertised Rp 3.871.000.
- ✅ The Meta Pixel and Stape stubs had a broken ternary — the `init` call threw
  on the first invocation, so neither pixel ever initialised.
- ✅ The GTM container ID was wrong (`GT-WR97B65V` is a Site Kit *tag* id, not
  a container). The real container is `GTM-NWMFR7ZN`, read out of the dump.
- ✅ Loading GA4 + Meta Pixel both directly *and* through GTM double-counted
  every page view. GTM is now the single source of truth.
- ✅ The mobile dock covered the footer's legal links.
- ✅ The blog showed the same three images on all 71 cards (the WordPress
  featured image was the same banner everywhere).

### Why the work stopped here

The fixes were necessary but not sufficient. The **logo** is the clearest
symptom: it is a 425×213 PNG crop whose flat-grey mountain overlaps the "V" of
the wordmark. At 34 px it is a grey smudge. No amount of CSS repairs that —
the asset itself is wrong.

Patching one component at a time without a written direction is how the page
ends up incoherent. So the work paused to produce two documents first:

- **`05-vision.md`** — the design direction: what the site is for, the three
  truths it must land, the palette/type/texture/motion rules, the photography
  rules, the logo redrawn as SVG, and the composition of the homepage.
- **`06-plan.md`** — the execution plan: six phases, each with a definition of
  done that can be checked.

From here the phases run in order. Phase 0 (fix the install) → Phase 1 (brand
core, including the SVG logo) → Phase 2 (repeating parts) → Phase 3 (homepage)
→ Phase 4 (blog & landings) → Phase 5 (ship).

---

*Last updated: 2026-11-10 — visual review done, defects fixed, direction reset with `05-vision.md` + `06-plan.md`.*
