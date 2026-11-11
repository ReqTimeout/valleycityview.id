#!/usr/bin/env node
/**
 * B10: lastmod JUJUR untuk sitemap — rewrite <lastmod> di dist/sitemap-*.xml
 * dari frontmatter Markdown (updated ?? date) untuk /blog/<slug>/ dan dari
 * prices.json syncedAt untuk money pages. Selain itu = build date (default
 * @astrojs/sitemap, dibiarkan).
 *
 * Dipanggil post-build:  pnpm --filter landing build
 * (script build landing = `astro build && node ../seo/fix-sitemap.mjs`).
 * Idempotent. Exit 1 kalau dist/sitemap tidak ditemukan (build gate).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEO_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SEO_DIR);
const DIST = join(ROOT, 'landing', 'dist');
const BLOG_DIR =
  process.env.SEO_CONTENT_DIR ?? join(ROOT, 'landing', 'src', 'content', 'blog');

function frontmatterDates(slug) {
  const path = join(BLOG_DIR, `${slug}.md`);
  if (!existsSync(path)) return null;
  const src = readFileSync(path, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const pub = m[1].match(/^date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  const upd = m[1].match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  return upd ?? pub;
}

function moneyLastmod() {
  try {
    const prices = JSON.parse(
      readFileSync(join(ROOT, 'landing', 'src', 'data', 'prices.json'), 'utf8'),
    );
    const d = String(prices.syncedAt ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

function lastmodFor(pathname) {
  const blog = pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (blog && blog[1] !== 'page') {
    // /blog\/ — halaman arsip: biarkan build date (selalu berubah saat publish)
    return frontmatterDates(blog[1]);
  }
  if (
    pathname.startsWith('/beli-') ||
    pathname.startsWith('/smm-panel-') ||
    pathname === '/layanan' ||
    pathname === '/layanan/' ||
    pathname === '/reseller' ||
    pathname === '/reseller/'
  ) {
    return moneyLastmod();
  }
  return null; // biarkan default build
}

const files = existsSync(DIST)
  ? readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f))
  : [];
if (files.length === 0) {
  console.error('fix-sitemap: dist/sitemap-*.xml tidak ditemukan — build gagal?');
  process.exit(1);
}

let changed = 0;
for (const f of files) {
  const p = join(DIST, f);
  const xml = readFileSync(p, 'utf8');
  // @astrojs/sitemap default TIDAK menulis <lastmod> — sisipkan yang jujur
  // untuk artikel blog + money pages; URL lain dibiarkan tanpa lastmod.
  const out = xml.replace(
    /<url>\s*<loc>(https:\/\/valleycity\.id([^<]*))<\/loc>\s*(?:<lastmod>[^<]*<\/lastmod>)?\s*<\/url>/g,
    (full, loc, pathname) => {
      const honest = lastmodFor(pathname.replace(/\/$/, '') || '/');
      if (!honest) return full;
      changed++;
      return `<url><loc>${loc}</loc><lastmod>${honest}</lastmod></url>`;
    },
  );
  if (out !== xml) writeFileSync(p, out);
}
console.log(`fix-sitemap: ${changed} lastmod ditulis ulang (${files.join(', ')})`);
