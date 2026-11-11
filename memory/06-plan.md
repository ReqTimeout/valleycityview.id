# Execution Plan — Valley Cityview rebuild

> Derived from `05-vision.md`. Every phase has a **definition of done** that
> can be checked, not a feeling. Phases run in order. Nothing starts before
> the phase before it is green.

Legend: ✅ done · 🟡 in progress · ⬜ todo · ⛔ blocked

---

## Phase 0 — Stop the bleeding (technical debt) — ✅

| # | Task | Done when |
|---|---|---|
| 0.1 | Remove the abandoned `@astrojs/mdx` dependency | `npm ci` succeeds — it previously failed on Cloudflare Pages because the dependency was **UNMET** |
| 0.2 | Prune the ~200 extraneous MDX packages from `node_modules` | `npm ls` shows no extraneous packages |
| 0.3 | Upgrade Astro 5 → 7, `@astrojs/svelte` 7 → 9, Svelte 5, sharp 0.35 | Build green, `astro check` clean |
| 0.4 | Keep the reference checker + copy linter in the build pipeline | `sh tools/migrate.sh` runs green end to end |

**Why first:** every later phase touches the same files. A broken install
makes every later phase slower to verify.

---

## Phase 1 — Brand core — ✅

| # | Task | Done when |
|---|---|---|
| 1.1 | Use the brand's own logo artwork: `logo-dark.png`, `logo-light.png`, `icon.png` | Legible at 48px in a 72px header; the mark alone works as the favicon |
| 1.2 | Replace the hand-drawn SVG logo and the "Logoipsum" placeholder everywhere | No `<svg class="logo">` left; header, footer, landing bar and favicon all use `/brand/*` |
| 1.3 | Lock the token set: colour, type scale, radii, spacing, motion | `global.css` is the only place a value is defined; **one size per heading level** |
| 1.4 | Rebuild the contour motif as one reusable inline-SVG component | `<Contour>` used once per section transition, no CSS `background-image` hacks |

**Owner decision, 2026-11-10:** the logo is **not** redrawn. The original
artwork is used unchanged; only the file, the size and the variant change.

---

## Phase 2 — The repeating parts — ✅

| # | Component | Done when |
|---|---|---|
| 2.1 | Buttons (`.btn` + variants) | One accent per viewport; hover is a 1.02 scale, never a colour jump |
| 2.2 | Section header (eyebrow / title / lead) | Identical rhythm on all 10 sections; eyebrow is 12px teal everywhere |
| 2.3 | Media frame (image + caption + optional badge) | Consistent radius, hairline, no shadow |
| 2.4 | Card | Hairline border, no shadow, sand or white background |
| 2.5 | Header + announce bar | Transparent over the hero, white logo, solid after scroll; **the promo stays visible on a phone** |
| 2.6 | Mobile dock | iOS-style, auto-hides on scroll down, **never covers the hero's CTA** |
| 2.7 | Footer | Four columns, real links, legal row, dark teal, **the WhatsApp button is readable** |
| 2.8 | Forms (booking) | Honeypot, inline validation, no layout shift on error |

---

## Phase 3 — Homepage — ✅

| # | Section | Done when |
|---|---|---|
| 3.1 | Hero | Real photo of the unit at dusk; headline + the three numbers; one accent CTA; no ragged edges at 390px |
| 3.2 | Proof strip | Four facts, full-bleed sand band, no cards |
| 3.3 | Tentang | Text + one real photo + one stat chip |
| 3.4 | Unit & denah | The floor-plan **drawing** (cropped out of the poster), spec list, price card |
| 3.5 | Panorama 360 | Full-bleed dark band, the embed is the focus |
| 3.6 | Galeri | 9 real photos, row-driven mosaic, **no empty tile, no hole in the grid** |
| 3.7 | Lokasi | The real aerial photo, then the four access times |
| 3.8 | KPR | Simulator; default state shows Rp 3.871.000 exactly |
| 3.9 | FAQ | Six real questions, **aligned with every other section** |
| 3.10 | Booking | Form + WhatsApp alternative side by side |

---

## Phase 4 — Blog & landing pages — ✅ (blog) · 🟡 (landing pages)

| # | Task | Done when |
|---|---|---|
| 4.1 | Blog index | Featured post + grid; 12 posts per page; covers are the project's own photos |
| 4.2 | Post layout | Readable measure (~68ch), aside price card, related posts, share row |
| 4.3 | 71 imported posts | Titles, descriptions and bodies rewritten: no clickbait, no competitor headline, no agency pitch, no emoji, "Anda" throughout |
| 4.4 | 6 landing pages | `promo`, `nup`, `sale`, `agent`, `agent/terms`, `agent/alt` rebuilt on the new system — **still to review on the new design** |
| 4.5 | `privacy` + `thank-you` | Hand-written, no WordPress template leftovers |

---

## Phase 5 — Ship readiness — 🟡

| # | Task | Done when |
|---|---|---|
| 5.1 | Visual review | Screenshots at 390px and 1440px, every page, no layout defect — **home, blog and KPR verified** |
| 5.2 | `tools/check_refs.py` | 0 broken references — **5167 references across 86 pages, all resolve** |
| 5.3 | `tools/check_copy.py` | 0 issues — **0 across 95 files** |
| 5.4 | Booking function | Tested end to end against `wrangler pages dev` — **not done yet** |
| 5.5 | Lighthouse | Performance / Accessibility / Best Practices / SEO ≥ 90 on mobile — **not done yet** |
| 5.6 | Cloudflare Pages config | Build `npm run build`, output `dist`, functions `functions/` |
| 5.7 | Redirects | 301 map verified against `_redirects` |

---

## Verification tooling

| Script | What it does |
|---|---|
| `site/scripts/screenshot.mjs` | Full-page shots at 390 and 1440 + a defect report: broken images, horizontal overflow, mixed heading sizes |
| `site/scripts/sections.mjs` | Section-by-section shots of the homepage |
| `site/scripts/shot.mjs` | One element by selector, cropped out of a full-page capture |
| `tools/rewrite_blog_meta.py` | Rewrites the 71 blog titles, descriptions and covers |
| `tools/clean_blog_bodies.py` | Strips the banner, the emoji, the agency pitch and the Google-search link from the bodies |

All three screenshot scripts use Playwright, which is installed globally on
this machine — they fall back to the global module folder when it is not in
the project.

---

## Open decisions for the user

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| Q1 | Price of record — Rp 3.871.000/bulan? | The WordPress homepage said "Rp 1.300.000 All In" while all 71 posts said Rp 3.871.000. The annuity maths supports Rp 3.871.000 (≈4,75 %/yr over 240 months). | Ship Rp 3.871.000 |
| Q2 | WhatsApp number | The backup contains three different numbers. | 0811-8801-0326 |
| Q3 | Booking destination | The form needs somewhere to send leads. | Email + KV archive, no third party |
| Q4 | Cloudflare account | Needed for the deploy. | — (blocked) |
| Q5 | Duplicate blog posts | 9 near-duplicate pairs (worst 0.97 Jaccard). | Keep all, flag for review |
| Q6 | WordPress | Retire entirely, or keep read-only as a reference? | Retire after launch |
| Q7 | Body copy of the 71 posts | Titles, descriptions and the template tails are rewritten; the middle of each article is still the imported text. | Needs an editorial pass before launch |
