# Valley Cityview — Rebuild Memory

Living documentation for the WordPress → Cloudflare Pages rebuild.

| File | Purpose |
|---|---|
| [00-audit.md](./00-audit.md) | Full audit of the WordPress backup (bugs, SEO risk, design gaps) |
| [01-decisions.md](./01-decisions.md) | Decision log — what was chosen and why |
| [02-content-map.md](./02-content-map.md) | Content inventory + old→new URL / component mapping |
| [03-progress.md](./03-progress.md) | Step-by-step progress log (updated every step) |
| [04-todo.md](./04-todo.md) | Task checklist with status |
| [05-vision.md](./05-vision.md) | **The design vision — read this before any design work** |
| [06-plan.md](./06-plan.md) | **The execution plan — phases with a definition of done** |
| `legacy-landings/` | The 6 original static landing pages, kept for reference |
| `legacy-pages/` | The original WordPress privacy + thank-you pages (archived, not live) |

**Rule:** this folder is updated after every step of work. Read `03-progress.md` first to resume.

---

## Quick reference

- **Workspace:** `/Volumes/miniex/Users/maabook/web-project/valleycityview.id`
- **WP backup:** `domains/valleycity.id/public_html/` (439 MB tar.gz + 84 MB SQL, already extracted)
- **SQL dump:** `u303432922_VOIEj.20261109135002.sql.gz`
- **New site root:** `site/` (Astro project)
- **Migration tooling:** `tools/` (see below)
- **Target:** Cloudflare Pages (account pending — user will provide)
- **Live domain:** `https://valleycity.id`

---

## Tooling

| Tool | What it does |
|---|---|
| `tools/wp_sql.py` | Reads the mysqldump directly — no MySQL server needed |
| `tools/wp_html.py` | WordPress/Elementor HTML → clean semantic HTML |
| `tools/export_content.py` | Writes the content collections, manifests and redirect map |
| `tools/check_refs.py` | Resolves every local `src`/`href`/`srcset` against the build output |
| `tools/check_copy.py` | Indonesian copy linter (garbled text, glued words, spacing) |
| `tools/migrate.sh` | scan → media → export → build → verify, in one command |
| `site/scripts/optimize-media.mjs` | `sharp` → responsive WebP |
| `site/scripts/generate-redirects.mjs` | Writes `public/_redirects` for Cloudflare Pages |
| `site/plugins/rehype-responsive-images.mjs` | Adds `srcset`/dimensions to images inside posts |

Run the whole thing with:

```sh
sh tools/migrate.sh
```

---

## Current state

- **80 pages** built, 45 MB `dist/`.
- **5114 local references — every one resolves.**
- **Copy linter: 0 issues across 93 files.**
- Media: 127.6 MB source → 36 MB shipped.
- Waiting on the user for: Cloudflare account, price confirmation, booking destination.