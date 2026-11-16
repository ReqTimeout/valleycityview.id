/**
 * seo/banner.mjs — cover artikel + alt SEO (port pola sbdental memory/05).
 *
 * Prinsip yang dijaga:
 * - Setiap artikel punya `cover:` (peta kategori → aset curated yang ADA di
 *   disk) — jangan pernah menunjuk file yang tidak ada.
 * - `imageAlt:` = "${title} — ${caption}" → unik antar artikel (memuat judul)
 *   dan JUJUR tentang isinya (caption berasal dari media-kinds.json, verdict
 *   per aset: foto nyata / visualisasi / denah / poster).
 * - Alt di halaman = imageAlt ?? caption aset ?? judul (lihat blog/[slug].astro).
 * - Aset tidak dibuat ulang di sini; kalau butuh banner teks khusus (gaya
 *   sbdental), tambahkan file + record media-kinds.json dulu, baru masukkan peta.
 *
 * Idempoten: applyCover menambah/menbarui baris cover & imageAlt di frontmatter
 * tanpa menyentuh bagian lain — aman dijalankan berulang (backfill).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BLOG_DIR = process.env.SEO_CONTENT_DIR || join(ROOT, 'site/src/collections/blog');
const KINDS_PATH = join(ROOT, 'site/src/data/media-kinds.json');

/** Peta kategori antrean → aset curated (pilihan sadar dari caption aset). */
const CATEGORY_COVER = {
  lokasi: '/media/curated/knowledge-1.webp',     // foto jalan masuk — lokasi nyata
  legalitas: '/media/curated/denah-45-72.webp',  // gambar teknis — kaitan izin/denah
  kpr: '/media/curated/design-45.webp',          // tampak depan unit — aspirasi punya rumah
  harga: '/media/curated/pricelist.webp',        // lembar daftar harga — persis untuk harga
  panduan: '/media/curated/hero-3.webp',         // sudut baca — pas untuk panduan
  unit: '/media/curated/foto-1.webp',            // foto unit asli (kanopi carport)
  agen: '/media/curated/foto-2.webp',            // foto tampak depan + mobil — tim/sales
};
const FALLBACK_COVER = '/media/curated/design-45.webp'; // juga og default Seo.astro

let CAPTIONS = null;
function captions() {
  if (CAPTIONS) return CAPTIONS;
  CAPTIONS = {};
  try {
    const rec = JSON.parse(readFileSync(KINDS_PATH, 'utf8'));
    for (const kind of ['foto', 'render', 'poster', 'denah']) {
      for (const [name, caption] of Object.entries(rec[kind] || {})) CAPTIONS[name] = caption;
    }
  } catch { /* tanpa verdict → alt jatuh ke judul saja */ }
  return CAPTIONS;
}

/** '/media/curated/design-45-1200.webp' → 'design-45' (sama seperti mediaName). */
function assetKey(path) {
  return String(path)
    .replace(/^.*\/media\/(?:curated\/)?/, '')
    .replace(/-\d{3,4}\.webp$/, '')
    .replace(/\.webp$/, '');
}

export function coverFor({ category, keyword } = {}) {
  const key = String(category || '').toLowerCase().trim();
  if (CATEGORY_COVER[key]) return CATEGORY_COVER[key];
  // Cadangan: tebak longgar dari kata kunci (antrean bisa punya kategori baru).
  const kw = String(keyword || '').toLowerCase();
  if (/kpr|cicilan|dp\b|angsuran/.test(kw)) return CATEGORY_COVER.kpr;
  if (/harga|biaya|price/.test(kw)) return CATEGORY_COVER.harga;
  if (/lokasi|alamat|dekat|stasiun|tol|kota|kelurahan/.test(kw)) return CATEGORY_COVER.lokasi;
  return FALLBACK_COVER;
}

/** Alt unik + jujur: judul artikel + caption aset. */
export function imageAltFor(title, coverPath) {
  const cap = captions()[assetKey(coverPath)] || '';
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (cap) return `${t} — ${cap}`.slice(0, 200);
  return t.slice(0, 200);
}

function fmTitle(mdx) {
  const m = mdx.match(/^---\n([\s\S]*?)\n---/);
  const fm = m ? m[1] : '';
  const t = fm.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
  return t ? t[1].trim() : '';
}

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/**
 * Sisipkan/perbarui `cover:` + `imageAlt:` pada frontmatter. Idempoten:
 * nilai sudah benar → tidak berubah; nilai beda → ditimpa; tidak ada → disisipkan.
 * @returns {{mdx: string, changed: boolean, cover: string, imageAlt: string}}
 */
export function applyCover(mdx, { category, keyword } = {}) {
  const head = mdx.match(/^---\n([\s\S]*?)\n---/);
  if (!head) return { mdx, changed: false, cover: '', imageAlt: '' };
  let fm = head[1];
  const title = fmTitle(mdx);

  let cover = (fm.match(/^cover:\s*"([^"]+)"/m) || [])[1] || '';
  if (!cover) {
    cover = coverFor({ category, keyword });
    fm += `\ncover: "${cover}"`;
  }
  let alt = (fm.match(/^imageAlt:\s*"([^"]+)"/m) || [])[1] || '';
  const wanted = imageAltFor(title, cover);
  if (alt !== wanted) {
    if (/^imageAlt:/m.test(fm)) fm = fm.replace(/^imageAlt:.*$/m, `imageAlt: "${esc(wanted)}"`);
    else fm += `\nimageAlt: "${esc(wanted)}"`;
  }
  const out = `---\n${fm}\n---` + mdx.slice(head[0].length);
  return { mdx: out, changed: out !== mdx, cover, imageAlt: wanted };
}

/**
 * Backfill semua artikel (draft + terbit) yang belum punya cover/imageAlt.
 * Kategori diambil dari antrean per slug; artikel legacy yang sudah punya cover
 * hanya diberi imageAlt (dari caption asetnya sendiri).
 * Jalankan: node seo/banner.mjs --write   (tambah --dry untuk pratinjau)
 */
async function backfill() {
  const dry = process.argv.includes('--dry');
  const write = process.argv.includes('--write');
  let queue = { items: [] };
  try { queue = JSON.parse(readFileSync(process.env.SEO_QUEUE_PATH || join(ROOT, 'seo/queue.json'), 'utf8')); } catch {}
  const cat = new Map((queue.items || []).map((i) => [i.slug, i]));
  const files = existsSync(BLOG_DIR)
    ? (await import('node:fs')).readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
    : [];
  let changed = 0;
  for (const f of files) {
    const path = join(BLOG_DIR, f);
    const src = readFileSync(path, 'utf8');
    const slug = (f.replace(/\.(md|mdx)$/, ''));
    const item = cat.get(slug) || {};
    const r = applyCover(src, { category: item.category, keyword: item.keyword });
    if (!r.changed) continue;
    changed++;
    console.log(`  ${slug} → cover ${r.cover.split('/').pop()}`);
    if (write) writeFileSync(path, r.mdx);
  }
  console.log(`backfill-image: ${changed}/${files.length} file${dry ? ' (dry-run)' : write ? ' ditulis' : ' (tanpa --write)'}`);
}
if (process.argv[1] && /banner\.mjs$/.test(process.argv[1])) await backfill();
