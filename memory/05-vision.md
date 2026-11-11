# Design Vision — Valley Cityview

> Written **before** the implementation, and revised once the design was
> actually reviewed in a browser. Everything below is a decision, not a
> suggestion. Work follows this document; nothing gets invented on the fly.

---

## 1. What this site is

A single-page sales site for one housing project (Valley Cityview, tipe 45/72,
Laksanamekar — Padalarang — Cimahi). It is not a magazine, not a corporate
site, not a real-estate portal.

**One job:** get a visitor who is *already interested* to reserve a unit
(booking fee Rp 5 juta) by sending their name and number to WhatsApp.

**The audience:** people in Cimahi/Bandung on an Android phone, 4G, comparing
"perumahan baru di Cimahi" on Google at night. They are skeptical of glossy
developer sites and they check the photos.

---

## 2. The three truths the page has to land

Everything on the page exists to make one of these land.

| # | Truth | How it is proved |
|---|---|---|
| 1 | **"Ini proyek beneran, bukan gambar."** | Real photographs of the actual unit and the actual site. AI renders only as atmosphere, always labelled "ilustrasi". |
| 2 | **"Harganya masuk akal dan angkanya jelas."** | Rp 599 juta / Rp 3.871.000 per bulan / Rp 5 juta booking fee — set in large type, never in small grey text. |
| 3 | **"Its close enough to my life."** | KCIC 15 menit, Unjani 10 menit, Tol Baros 15 menit, lahan di ketinggian. Concrete minutes, not adjectives. |

If a section does not serve one of the three, it is cut.

---

## 3. Art direction — "Lembah"

> A valley seen at golden hour from a balcony: layered ridges, warm light,
> cool shadow.

**Palette** — one deep colour, one accent, one paper. Nothing else.

| Token | Value | Role |
|---|---|---|
| `--brand-900` | `#012a33` | Deep valley shadow. Dark sections, footer, hero scrim. |
| `--brand-700` | `#01505d` | Valley teal. Primary brand colour, buttons, links. |
| `--brand-050` | `#eff7f8` | Tinted surfaces, icon chips. |
| `--accent-500` | `#fee203` | Sun. **The only accent.** Price highlights, active states, one CTA per view. |
| `--sand-100` | `#f4efe4` | Paper. Alternating section background. |
| `--ink-900` | `#16211f` | Body text. |

Rules:
- The accent never appears twice in the same viewport as two different kinds
  of thing.
- `--sand-100` and `--sand-200` are the only neutrals besides ink.
- **WhatsApp green is the only foreign colour** (`--wa-500`), and it appears on
  WhatsApp buttons only. It is a platform convention, not a brand colour.
- No other green exists on the site. (The old build had a "KPR badge" in a
  second green that appeared nowhere else.)

**Type**

- Display: **Fraunces** (opsz 9–144) — a high-contrast serif. Headlines,
  prices, section titles. Tight tracking, `line-height: 1.02–1.12`.
- Text: **Plus Jakarta Sans** — body, labels, UI.
- Prices are set in Fraunces. The price is the largest type on the page after
  the hero headline. That is deliberate.

**Structural type sizes — one per level, everywhere**

| Level | Token | Mobile | Desktop |
|---|---|---|---|
| Eyebrow | `--fs-eyebrow` (`--t-xs`) | 12px | 12px |
| Section heading | `--fs-h2` (`--t-3xl`) | 29px | 40px |
| Sub-heading | `--fs-h3` (`--t-xl`) | 19px | 22px |
| Lead paragraph | `--fs-lead` (`--t-lg`) | 17px | 19px |

The old build sized headings per section: the same H2 came out at 29px in seven
places and 24px in one, and the eyebrow rendered as a 19px grey lead
paragraph. That single cascade accident is most of why the page felt assembled
from templates. **A heading size is never set inside a section** — it comes
from the level, and the level is in `global.css`.

**Texture — the signature.** Layered contour lines (topographic ridges) drawn
as inline SVG, in teal on sand and in `brand-900` on the dark sections. It
appears once per section transition, never inside a card. This is what makes
the site look designed rather than templated.

**Corners and depth.** Large radii (16–28px) on media and cards, small radii
(8–10px) on inputs and chips. **No drop shadows on cards** — separation comes
from a 1px `--border` hairline and a change of background. Shadows are
reserved for things that float (dock, sticky header, lightbox).

**Motion.** Slow and few. Section content fades up 12px over 500ms with a
70ms stagger. The hero photo zooms 4% over 14s. Buttons scale to 1.02 on
hover. No bounce, no confetti, no parallax.

**Photography rules**

- Every image on the site is either a **real photograph of the project** or a
  clearly-labelled **ilustrasi**.
- Real photos, and where they are used:
  `design-45` (unit exterior at dusk — the hero), `design-24` / `design-25`
  (unit exterior, day and rear), `hero` (living room, valley at sunset),
  `hero-2` / `hero-3` (bedroom, study), `unit-3` (kitchen),
  `knowledge-1` (internal road with flags), `detail-5` (aerial of the site).
- **Never used:** `home-green` (a Norwegian cabin), `unit-1`/`unit-2`
  (dated marketing posters with a stock family), the WordPress theme stock
  photography (Alpine cottages, models, "team" photos).
- The floor plan is published inside a marketing poster. The **drawing** is
  cropped out by `scripts/optimize-media.mjs`; the poster's testimonial,
  stock photo and "42 / 72m" spec are not shown.

---

## 4. The logo — the brand's own artwork

**Decision (owner, 2026-11-10): the logo is not redrawn.** The artwork from
the WordPress media library is used as it is.

| File | Source | Use |
|---|---|---|
| `/brand/logo-dark.png` | `Untitled-design-16.png` (384×189) | Light backgrounds — header, landing bar |
| `/brand/logo-light.png` | `Untitled-design-26.png` (325×159) | Dark backgrounds — header over the hero, footer |
| `/brand/icon.png` | `cropped-Untitled-design-27.png` (468×468) | Favicon, apple-touch-icon |

Rules that follow from the artwork:

- The wordmark is a **two-line lockup**. It only reads from about 44px of
  height, so the header is 72px tall and the logo is rendered at 48px. It is
  not scaled down to fit a smaller header.
- The header renders **both** files and swaps them with CSS when it goes from
  "over the hero" to "scrolled". The logo never changes colour by filter.
- The logo is an `<img>` with `background: transparent` — the global
  placeholder colour for images would otherwise paint a light box behind the
  white wordmark and hide it.
- **Never** `Logo-1.png` … `Logo-4.png` or `Signature.png` — those are
  "Logoipsum" template placeholders, not this brand.

---

## 5. Composition

The homepage reads as **one long editorial page**, not a stack of sections
bolted together.

1. **Hero** — full-bleed real photo of the unit at dusk. Headline left, the
   three numbers (harga / cicilan / booking) as a panel, one accent CTA.
2. **Proof strip** — four facts on a sand band, full width, no cards.
3. **Tentang** — two columns: text left, one real photo right with a stat
   chip.
4. **Unit & denah** — the floor plan large, the spec list beside it.
5. **Panorama 360** — full-bleed dark band, the embed as the focus.
6. **Galeri** — mosaic of real photos, row-driven so it never leaves a hole.
7. **Lokasi** — the aerial photograph of the real site, then the four access
   times.
8. **KPR** — the simulator, dark panel, sticky result.
9. **FAQ** — six real questions, one column, aligned with every other section.
10. **Booking** — the form and the WhatsApp alternative side by side.

Each section starts with the same three-part eyebrow/title/lead pattern so the
page has a rhythm. Contour texture marks the transitions.

**Mobile specifics (390px is the design target)**

- The announce strip keeps the promo visible — shortened, never hidden.
- The header carries a compact yellow **Booking** button; the desktop one
  reads "Booking Unit".
- The hero price panel puts the price on its own row, the other two side by
  side — three items never wrap into a ragged 1 + 2.
- Hero buttons are full width.
- The mobile dock stays hidden over the hero so it can never cover the primary
  call to action, and appears after 620px.

---

## 6. The blog

71 posts imported from WordPress. They are the second-most-seen part of the
site after the homepage, so they are held to the same standard:

- **Titles state the subject.** No "Bikin Kaget!", "Bikin Shock!",
  "Terkejut dengan…", "Wow!". The search keyword stays — "Harga Rumah
  Podomoro Park Bandung" is still the keyword — but the headline does not
  perform.
- **A competitor's name is a subject to compare against, never the thing we
  sell.** The first headline on the site is no longer a competitor's brand.
- **One voice.** "Anda", never "Kamu".
- **No emoji in lists**, no repeated advert banner at the top of every post,
  no pitch for a third-party advertising agency, no "silakan cek Google
  Search" link.
- **Covers are the project's own photographs**, not one repeated banner.
- **12 posts per page** — `/blog/`, `/blog/2/` … — instead of one 38,000-pixel
  column.

---

## 7. Non-negotiables

- **Mobile first.** 390px is the design target; desktop is the wide version
  of the same composition, never a separate layout.
- **No stock photography.** No "Oslo Norway", no Alpine houses, no BMWs.
- **No fabricated numbers.** If a fact is not verified it does not appear.
- **No English loanwords** in user-facing copy. No "upgrade", "hustle",
  "priority", "premium".
- **One accent per viewport.**
- **Every image has an alt text** that describes the real thing.
- The whole page must work with JavaScript disabled: the Svelte islands are
  enhancements, not the page.
- **A heading size is set by its level, never by its section.**
