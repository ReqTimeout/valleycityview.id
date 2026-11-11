#!/usr/bin/env node
/**
 * seo/fix-sitemap.mjs — lastmod JUJUR untuk sitemap.
 *
 * @astrojs/sitemap default menulis build date untuk semua URL. Itu bohong dua
 * kali: halaman yang tidak berubah dapat tanggal baru tiap build, dan Google
 * belajar bahwa lastmod di domain ini tidak berarti apa-apa — setelah itu
 * isyaratnya dibuang. Script ini hanya menulis <lastmod> untuk URL yang
 * tanggalnya benar-benar bisa dibuktikan dari frontmatter (updated ?? date),
 * dan MEMBIARKAN tanpa lastmod untuk yang lain.
 *
 * Yang diubah dari versi socio.id:
 *   - path diambil dari seo/paths.mjs (site/dist, site/src/collections/blog),
 *     tidak lagi `landing/dist` dan `landing/src/content/blog`.
 *   - moneyLastmod() dibuang. Di socio.id halaman jasa punya prices.json
 *     dengan `syncedAt`, jadi lastmod-nya bisa dipertanggungjawabkan. Site ini
 *     punya satu harga rekaman di site/src/data/site.ts tanpa tanggal sinkron;
 *     memakai tanggal build sebagai lastmod halaman itu justru klaim palsu.
 *   - domain diambil dari site.mjs, tidak di-hardcode di regex.
 *
 * Dipanggil post-build:  cd site && npm run build  (astro build && node ../seo/fix-sitemap.mjs)
 * Idempoten. Exit 1 kalau dist/sitemap tidak ada (itu tanda build gagal).
 *
 * Perbaikan port: versi lama mencocokkan satu regex yang menuntut <lastmod>
 * sebagai sibling tepat setelah <loc>. Karena astro.config kita menyetel
 * changefreq + priority, tidak ada satu pun blok yang cocok dan laporan
 * "0 ditulis, 0 dibuang" artinya "tidak ada yang diperiksa" — bukan "sudah
 * benar". Sekarang setiap blok <url> dibaca utuh, jadi urutan sibling tidak
 * relevan. (Bug yang sama juga membuat `pathname` di callback selalu undefined,
 * karena regex itu cuma punya satu grup capture.)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { BLOG_DIR, DIST_DIR } from './paths.mjs';
import { SITE } from './site.mjs';

function frontmatterDates(slug) {
  const path = join(BLOG_DIR, `${slug}.md`);
  if (!existsSync(path)) return null;
  const src = readFileSync(path, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const pub = m[1].match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  const upd = m[1].match(/^updated:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  return upd ?? pub;
}

/**
 * URL yang boleh dapat lastmod: hanya artikel blog.
 * `/blog/page/2/` (arsip) dan halaman landing tidak — tidak ada peristiwa
 * terukur yang mengubah tanggalnya.
 */
function lastmodFor(pathname) {
  const blog = pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (blog && blog[1] !== 'page') return frontmatterDates(blog[1]);
  return null;
}

const files = existsSync(DIST_DIR)
  ? readdirSync(DIST_DIR).filter((f) => /^sitemap-\d+\.xml$/.test(f))
  : [];
if (files.length === 0) {
  console.error(`fix-sitemap: ${DIST_DIR}/sitemap-*.xml tidak ditemukan — build gagal?`);
  process.exit(1);
}

// URL kita saja; host lain (CDN, domain lama) bukan urusan script ini.
const ORIGIN = new URL(SITE);
const HOST_RE = new RegExp(
  '^https?://' + ORIGIN.hostname.replace(/[.]/g, '\\.') + '(?::\\d+)?(/[^<]*)?$',
);

let changed = 0;
let stripped = 0;
let examined = 0;

/**
 * Satu blok <url>…</url>: baca <loc>, buang <lastmod> apa pun yang ada, lalu
 * sisipkan tanggal yang bisa dibuktikan — atau tidak sama sekali.
 */
function rewriteUrl(block) {
  const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
  if (!loc) return block;
  const m = loc.match(HOST_RE);
  if (!m) return block;
  examined++;
  const pathname = (m[1] || '/').replace(/\/+$/, '') || '/';
  const honest = lastmodFor(pathname);
  const bare = block.replace(/\s*<lastmod>[^<]*<\/lastmod>/g, '');
  if (!honest) {
    if (bare !== block) stripped++;
    return bare;
  }
  if (block.includes(`<lastmod>${honest}</lastmod>`)) return block; // sudah jujur
  if (bare !== block) stripped++;
  changed++;
  return bare.replace(/<loc>[^<]+<\/loc>/, (t) => `${t}<lastmod>${honest}</lastmod>`);
}

for (const f of files) {
  const p = join(DIST_DIR, f);
  const xml = readFileSync(p, 'utf8');
  const out = xml.replace(/<url>[\s\S]*?<\/url>/g, rewriteUrl);
  if (out !== xml) writeFileSync(p, out);
}
console.log(
  `fix-sitemap: ${examined} URL diperiksa · ${changed} lastmod jujur ditulis · ${stripped} lastmod tanpa bukti dibuang (${files.join(', ')})`,
);
