#!/usr/bin/env node
/**
 * seo/fix-sitemap.mjs — lastmod JUJUR + sitemap gambar (image:image).
 *
 * @astrojs/sitemap default menulis build date untuk semua URL. Itu bohong dua
 * kali: halaman yang tidak berubah dapat tanggal baru tiap build, dan Google
 * belajar bahwa lastmod di domain ini tidak berarti apa-apa — setelah itu
 * isyaratnya dibuang. Script ini hanya menulis <lastmod> untuk URL yang
 * tanggalnya benar-benar bisa dibuktikan dari frontmatter (updated ?? date),
 * dan MEMBIARKAN tanpa lastmod untuk yang lain.
 *
 * Sitemap gambar (P2): tiap artikel blog punya cover curated di frontmatter
 * (`cover` = path publik /media/…, `imageAlt` = caption). Google Image Search
 * membaca <image:image> di sitemap untuk menemukan gambar artikel. Tanpa ini
 * gambar hanya ditemukan lewat crawl HTML — lebih lambat. Kita sisipkan
 * <image:loc> absolut + <image:title> + <image:caption> per URL blog.
 *
 * Idempoten: <lastmod> dan <image:image> lama dibuang dulu lalu ditulis ulang
 * dari frontmatter terkini, jadi menjalankan build berulang tidak menumpuk.
 *
 * Dipanggil post-build:  cd site && npm run build  (astro build && node ../seo/fix-sitemap.mjs)
 * Exit 1 kalau dist/sitemap tidak ada (itu tanda build gagal).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { BLOG_DIR, DIST_DIR } from './paths.mjs';
import { SITE } from './site.mjs';

/** Baca frontmatter artikel: tanggal jujur + cover + alt + judul (untuk gambar). */
function frontmatterMeta(slug) {
  const path = join(BLOG_DIR, `${slug}.md`);
  if (!existsSync(path)) return null;
  const src = readFileSync(path, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const grab = (k) => fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?`, 'm'))?.[1]?.trim() ?? null;
  const pub = fm.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  const upd = fm.match(/^updated:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
  return { lastmod: upd ?? pub, cover: grab('cover'), alt: grab('imageAlt'), title: grab('title') };
}

const ORIGIN = new URL(SITE);

/** URL gambar absolut dari cover frontmatter (path publik /media/…). */
function imageLoc(cover) {
  if (!cover) return null;
  if (/^https?:\/\//.test(cover)) return cover;
  return `${SITE.replace(/\/+$/, '')}/${cover.replace(/^\/+/, '')}`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Blok <image:image> untuk satu artikel — loc wajib, title/caption bila ada. */
function imageBlock(meta) {
  const loc = imageLoc(meta?.cover);
  if (!loc) return '';
  const title = meta.alt || meta.title || '';
  let b = `<image:image><image:loc>${esc(loc)}</image:loc>`;
  if (title) b += `<image:title>${esc(title.slice(0, 200))}</image:title>`;
  if (meta.alt) b += `<image:caption>${esc(meta.alt.slice(0, 300))}</image:caption>`;
  return b + '</image:image>';
}

const files = existsSync(DIST_DIR)
  ? readdirSync(DIST_DIR).filter((f) => /^sitemap-\d+\.xml$/.test(f))
  : [];
if (files.length === 0) {
  console.error(`fix-sitemap: ${DIST_DIR}/sitemap-*.xml tidak ditemukan — build gagal?`);
  process.exit(1);
}

const HOST_RE = new RegExp(
  '^https?://' + ORIGIN.hostname.replace(/[.]/g, '\\.') + '(?::\\d+)?(/[^<]*)?$',
);

let changed = 0;
let stripped = 0;
let examined = 0;
let images = 0;

/**
 * Satu blok <url>…</url>: baca <loc>, buang <lastmod> + <image:image> lama,
 * lalu sisipkan tanggal yang bisa dibuktikan dan gambar artikel (bila ada).
 */
function rewriteUrl(block) {
  const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
  if (!loc) return block;
  const m = loc.match(HOST_RE);
  if (!m) return block;
  examined++;
  const pathname = (m[1] || '/').replace(/\/+$/, '') || '/';
  const blog = pathname.match(/^\/blog\/([^/]+)\/?$/);
  const meta = blog && blog[1] !== 'page' ? frontmatterMeta(blog[1]) : null;
  const honest = meta?.lastmod ?? null;

  let bare = block
    .replace(/\s*<lastmod>[^<]*<\/lastmod>/g, '')
    .replace(/\s*<image:image>[\s\S]*?<\/image:image>/g, '');
  if (bare !== block) stripped++;

  let out = bare;
  if (honest) {
    out = out.replace(/<loc>[^<]+<\/loc>/, (t) => `${t}<lastmod>${honest}</lastmod>`);
    changed++;
  }
  const img = imageBlock(meta);
  if (img) {
    out = out.replace(/<\/url>\s*$/, `${img}</url>`);
    images++;
  }
  return out;
}

const IMG_NS = 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';

for (const f of files) {
  const p = join(DIST_DIR, f);
  const xml = readFileSync(p, 'utf8');
  let out = xml.replace(/<url>[\s\S]*?<\/url>/g, rewriteUrl);
  // Deklarasi namespace image di <urlset> sekali saja (idempoten).
  if (images > 0 && !out.includes('xmlns:image=')) {
    out = out.replace(/<urlset\b([^>]*)>/, (t, attrs) => `<urlset${attrs} ${IMG_NS}>`);
  }
  if (out !== xml) writeFileSync(p, out);
}
console.log(
  `fix-sitemap: ${examined} URL diperiksa · ${changed} lastmod jujur · ${images} gambar (image:image) · ${stripped} blok lama dibuang (${files.join(', ')})`,
);