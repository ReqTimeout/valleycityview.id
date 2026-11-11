/**
 * seo/lib/live-posts.mjs — satu definisi "artikel ini tayang".
 *
 * Predikatnya harus SAMA dengan yang dipakai route blog di Astro:
 *   site/src/pages/blog/[slug].astro
 *     getCollection('blog', ({ data }) => data.status === 'publish' && !data.redirectTo)
 *
 * Kalau mesin dan route punya pendapat berbeda, dua hal buruk terjadi, dan keduanya diam-diam:
 *   1. mesh-build menaruh related/post-link ke slug yang ternyata 301 — artikel
 *      baru lahir dengan internal link yang melempar redirect;
 *   2. qc-uniqueness membandingkan draft baru dengan stub redirect yang masih
 *      menyimpan body lengkap (203 baris), lalu menandai duplikat terhadap
 *      konten yang justru tidak pernah disajikan ke pembaca.
 *
 * Jadi: jangan tambah filter status di tempat lain. Impor dari sini.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { BLOG_DIR } from '../paths.mjs';

const NL = String.fromCharCode(10);

/** Nama slug dari nama berkas Markdown. */
export function slugOf(file) {
  return file.replace(/\.md$/, '');
}

/**
 * Predikat kanonik. `fm` = frontmatter hasil parse (objek) atau teks
 * frontmatter mentah (string) — keduanya dipakai pemanggil.
 */
export function isLive(fm) {
  if (typeof fm === 'string') {
    return /^status:\s*publish\s*$/m.test(fm) && !/^redirectTo:/m.test(fm);
  }
  return fm?.status === 'publish' && !fm?.redirectTo;
}

/** Semua berkas .md di collection (termasuk redirect/draft) — untuk tabrakan slug. */
export function allFiles() {
  if (!existsSync(BLOG_DIR)) return [];
  return readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));
}

export function allSlugs() {
  return allFiles().map(slugOf);
}

/** Slug yang benar-benar tayang, dibaca dari frontmatter mentah (tanpa parser YAML). */
export function liveSlugs() {
  const out = [];
  for (const f of allFiles()) {
    const src = readFileSync(join(BLOG_DIR, f), 'utf8');
    const end = src.indexOf(NL + '---', 3);
    const fm = end > 0 ? src.slice(0, end) : '';
    if (isLive(fm)) out.push(slugOf(f));
  }
  return out;
}

/**
 * Slug draft — yang di-push ke review, bukan yang dihitung sebagai konten.
 * `status: review` sengaja tidak masuk: itu kandidat tayang yang sedang
 * menunggu gerbang QC, bukan pekerjaan yang belum dimulai.
 */
export function draftSlugs() {
  const out = [];
  for (const f of allFiles()) {
    const src = readFileSync(join(BLOG_DIR, f), 'utf8');
    if (/^status:\s*draft\s*$/m.test(src)) out.push(slugOf(f));
  }
  return out;
}

/**
 * Metadata ringan tiap berkas collection. Dibaca dari frontmatter mentah —
 * sama seperti liveSlugs(), supaya dashboard dan mesin tidak butuh parser YAML
 * dan tidak pernah berbeda pendapat dengan zod soal field mana yang ada.
 * Hanya field yang benar-benar dipakai pemanggil yang ikut dikembalikan.
 */
export function posts() {
  const out = [];
  for (const f of allFiles()) {
    const src = readFileSync(join(BLOG_DIR, f), 'utf8');
    const end = src.indexOf(NL + '---', 3);
    const fm = end > 0 ? src.slice(0, end) : '';
    const grab = (k) => (fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]*)"?\\s*$`, 'm')) || [])[1]?.trim() || null;
    out.push({
      file: f,
      slug: slugOf(f),
      title: grab('title'),
      date: grab('date'),
      updated: grab('updated'),
      status: grab('status'),
      redirectTo: grab('redirectTo'),
      live: isLive(fm),
    });
  }
  return out;
}
