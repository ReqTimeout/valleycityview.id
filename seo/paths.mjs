/**
 * seo/paths.mjs — single source of truth for all SEO script paths.
 * Ported from ssoe-runner; the derivation is unchanged, only the layout:
 * this repo keeps the Astro site in site/ and the engine at the repo root,
 * and content is plain Markdown (.md) with raw HTML, not Markdown.
 *
 * Env overrides let the runner container mount persistent state on a volume:
 *   SEO_STATE_PATH · SEO_CONFIG_PATH · SEO_QUEUE_PATH · SEO_CONTENT_DIR
 * Defaults stay inside the repo so local behaviour needs no setup.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ROOT = repo root (one level up from seo/)
export const ROOT = join(__dirname, '..');

export const SITE_DIR = join(ROOT, 'site');

// The blog collection Astro actually builds from.
export const BLOG_DIR = process.env.SEO_CONTENT_DIR
  ? resolve(process.env.SEO_CONTENT_DIR)
  : join(SITE_DIR, 'src/collections/blog');

export const QUEUE_PATH = process.env.SEO_QUEUE_PATH
  ? resolve(process.env.SEO_QUEUE_PATH)
  : join(ROOT, 'seo/queue.json');

export const STATE_PATH = process.env.SEO_STATE_PATH
  ? resolve(process.env.SEO_STATE_PATH)
  : join(ROOT, 'seo/state.json');

export const CONFIG_PATH = process.env.SEO_CONFIG_PATH
  ? resolve(process.env.SEO_CONFIG_PATH)
  : join(ROOT, 'seo/config.json');

// Jejak eksekusi runner (Fase 11). Ikut ke volume yang sama dengan state.json:
// di dalam container, apa pun yang ditulis ke worktree hilang saat image diganti.
export const RUNS_PATH = process.env.SEO_RUNS_PATH
  ? resolve(process.env.SEO_RUNS_PATH)
  : join(ROOT, 'seo/runs.json');

// The numbers the articles must never contradict (price of record etc).
export const SITE_DATA_PATH = join(SITE_DIR, 'src/data/site.ts');

export const PROMPTS_PATH = join(ROOT, 'seo/prompts.ts');
export const CITIES_PATH = join(ROOT, 'seo/cities.json');

// Daftar keyword yang sudah disetujui manusia. generate.mjs berhenti kalau
// berkas ini belum di-approve — ini penerus `keywords.geo.json` (980 KB matriks
// kota x layanan) di socio.id, yang tidak punya padanan di site satu produk.
export const KEYWORDS_PATH = process.env.SEO_KEYWORDS_PATH
  ? resolve(process.env.SEO_KEYWORDS_PATH)
  : join(ROOT, 'seo/keywords.json');

// Build artefacts: read-only for the engine. It never writes into dist —
// publishing means committing Markdown and letting `npm run build` produce
// the HTML, sitemap included.
export const DIST_DIR = join(SITE_DIR, 'dist');
export const SITEMAP_PATH = join(DIST_DIR, 'sitemap-0.xml');
export const PUBLIC_DIR = join(SITE_DIR, 'public');

// Fase 10 langkah 0 — the audit gate. generate/publish refuse to run while
// it reports unclosed.
export const AUDIT_GATE_PATH = join(ROOT, 'site/scripts/audit-posts.mjs');
export const AUDIT_DECISIONS_PATH = join(ROOT, 'audit/posts.json');

// ---- dashboard/ (Fase 11) -------------------------------------------------
// Proyek Cloudflare Pages TERPISAH. Dashboard tidak pernah jadi bagian build
// site/ — satu route saja yang bocor ke `site/src/pages/` sudah cukup untuk
// membuat halaman internal ikut ter-deploy ke domain publik.
export const DASHBOARD_DIR = join(ROOT, 'dashboard');
export const DASHBOARD_DIST = join(DASHBOARD_DIR, 'dist');
