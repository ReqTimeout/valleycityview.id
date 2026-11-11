# Task Checklist — Valley Cityview Rebuild

> The authoritative checklist is [`06-plan.md`](./06-plan.md). This file is the
> short version. Read [`05-vision.md`](./05-vision.md) first.

Legend: ⬜ todo · 🟡 doing · ✅ done · ⛔ blocked

## Phase 0 — Stop the bleeding
- [ ] 0.1 Remove the abandoned `@astrojs/mdx` dependency (`npm ci` currently fails)
- [ ] 0.2 Prune the ~200 extraneous MDX packages
- [ ] 0.3 Upgrade Astro 5 → 7, `@astrojs/svelte` 7 → 9, Svelte → 5.57, sharp → 0.35
- [x] 0.4 Reference checker + copy linter wired into `tools/migrate.sh`

## Phase 1 — Brand core
- [ ] 1.1 Redraw the logo as SVG (`logo.svg`, `logo-light.svg`, `mark.svg`)
- [ ] 1.2 Replace the PNG logo everywhere (header, footer, landing, favicon)
- [ ] 1.3 Lock the token set in `global.css`
- [ ] 1.4 Rebuild the contour motif as one inline-SVG component

## Phase 2 — The repeating parts
- [ ] 2.1 Buttons · 2.2 Section header · 2.3 Media frame · 2.4 Card
- [ ] 2.5 Header · 2.6 Mobile dock · 2.7 Footer · 2.8 Forms

## Phase 3 — Homepage
- [ ] 3.1 Hero · 3.2 Proof strip · 3.3 Tentang · 3.4 Unit & denah
- [ ] 3.5 Panorama 360 · 3.6 Galeri · 3.7 Lokasi · 3.8 KPR
- [ ] 3.9 FAQ · 3.10 Booking

## Phase 4 — Blog & landing pages
- [ ] 4.1 Blog index · 4.2 Post layout · 4.3 Copy pass on the 71 posts
- [ ] 4.4 The 6 landing pages · 4.5 privacy + thank-you

## Phase 5 — Ship readiness
- [ ] 5.1 Visual review at 390px / 1440px
- [ ] 5.2 `tools/check_refs.py` → 0 broken references
- [ ] 5.3 `tools/check_copy.py` → 0 issues
- [ ] 5.4 Booking function tested with `wrangler pages dev`
- [ ] 5.5 Lighthouse ≥ 90 mobile
- [ ] 5.6 Cloudflare Pages config · 5.7 Redirect map verified

## Open decisions
See the table at the end of [`06-plan.md`](./06-plan.md) — Q1 price, Q2 WhatsApp
number, Q3 booking destination, Q4 Cloudflare account, Q5 duplicate posts,
Q6 WordPress.
