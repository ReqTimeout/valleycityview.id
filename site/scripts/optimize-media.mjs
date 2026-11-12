/**
 * Re-encode every referenced WordPress upload into WebP at responsive widths.
 *
 * Input : src/data/media-needed.json   (produced by tools/export_content.py)
 * Output: public/media/**.webp
 *         src/data/media-manifest.json  (key = "/media/…" path used in the MDX)
 *
 * Run with:  npm run media
 */

/* --- What the curated set actually is (PLAN.md F6) -----------------------

   Every asset was opened and looked at, tiled into .review/gallery9.png and
   .review/landing4.png with scripts/contact-sheet.mjs. The derived WebP
   files carry no EXIF (scripts/media-meta.mjs reports every one of them as
   "bare"), so provenance comes from the original WordPress filename kept in
   src/data/curated-media.json, and the verdict comes from the eyes.

   REAL PHOTOGRAPHS of this project:
     knowledge-1   access road inside the kawasan, project banners visible
     detail-5      aerial of the land at Laksanamekar, next to the toll road
     foto-1..3     owner-supplied photos of a BUILT unit (Nov 2026, from
                   image/WhatsApp …; clean photographs, no marketing text).
                   These are the first real exteriors the hero is allowed
                   to run — design-45 (a render) was the homepage hero and
                   the about slot only while no photo existed.

   RENDERS / VISUALISATIONS — may be shown, must carry the "Ilustrasi" chip:
     design-45     dusk exterior (former homepage hero — a render, not a photo)
     design-24     daytime exterior, front yard and carport
     design-25     rear exterior with carport and canopy
     hero          living room interior
     hero-2        bedroom interior, glass door to the garden
     hero-3        study nook / daybed room
     unit-3        kitchen opening to the back garden
     unit-4 … 7    interior details
     detail-1 … 7  interior details (detail-5 excepted — it is the aerial photo)
     knowledge-2   project gate at dusk
     knowledge-3   cluster seen from the air
     knowledge-4   park and running track against the cliff
     render, render-2, whisk-1, whisk-2   Gemini/Whisk exports, watermark on two
     inspection    3D icon illustration, a picture of nothing

   MARKETING POSTERS — banned by the vision, never placed on a page:
     unit-1, unit-2   stock family photo / logo over an aerial
     home-green       a Norwegian cabin that is not this project
     pricelist        price-list graphic, kept only as a document
     hero-alt         decorative mountain texture

   The record lives in src/data/media.ts, which the pages read to decide
   whether to render the chip. This comment is the human-readable copy; if the
   two disagree, media.ts wins and this comment is stale.

   Consequence for the owner, stated once here so it is not forgotten: as
   of Nov 2026 the library holds three photographs of a finished unit
   (foto-1..3) plus the road and the aerial. Renders still wear the
   "Ilustrasi" chip everywhere they appear; the homepage hero and the
   about picture are real photographs and carry no chip.

   Denah (D5): denah-45-72.webp was re-opened after the crop below — every
   dimension label including the right-hand "500" survives at width 850, and
   the drawing is a 2D furnished plan, not a 3D render. The crop is correct as
   configured; no caption change needed.
   ---------------------------------------------------------------------- */

import { readFile, writeFile, mkdir, stat, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const workspace = path.resolve(siteRoot, '..');
const publicDir = path.join(siteRoot, 'public');
const dataDir = path.join(siteRoot, 'src', 'data');

/** Widths we generate for every raster image. */
const WIDTHS = [400, 800, 1200, 1600];
const QUALITY = 78;
/** Files smaller than this are served as-is (icons, tiny badges). */
const INLINE_LIMIT = 3 * 1024;

const needed = JSON.parse(
  await readFile(path.join(dataDir, 'media-needed.json'), 'utf-8'));

/*
  Manifest dari run sebelumnya. Sumber WordPress lama tidak selalu ada di
  disk (folder uploads/2025/04..09 pernah dibersihkan dari ekspor hosting);
  tanpa ini, `npm run media` menghapus turunan yang masih dipakai halaman
  hanya karena aslinya tidak ketemu — kejadian nyata 12 Nov 2026, 544 file
  curated ikut ter-prune. Turunan yang sumbernya hilang kini dipertahankan
  apa adanya (di-commit; regenerasi terjadi lagi begitu sumber kembali).
*/
let previous = {};
try {
  previous = JSON.parse(
    await readFile(path.join(dataDir, 'media-manifest.json'), 'utf-8'));
} catch { /* run pertama — tidak ada yang dipertahankan */ }

const manifest = {};
/** Destination path -> optimised entry + the old WordPress path it came from. */
const sourceMap = {};
/** Every file we wrote this run — anything else under public/media is stale. */
const written = new Set();
let srcBytes = 0;
let outBytes = 0;
let done = 0;
let keptFromPrevious = 0;
const skipped = [];

for (const item of needed) {
  const srcPath = path.join(workspace, item.src);
  if (!existsSync(srcPath)) {
    skipped.push(item.src);
    const prev = previous[item.dest];
    if (prev) {
      // Pertahankan entri + semua varian lebar lama dari daftar tulis.
      manifest[item.dest] = prev;
      sourceMap[item.dest] = { oldPath: '(sumber tidak ada di disk, dipertahankan dari run sebelumnya)', ...prev };
      written.add(path.join(publicDir, item.dest.replace(/^\//, '')));
      for (const part of (prev.srcset || '').split(', ').filter(Boolean)) {
        written.add(path.join(publicDir, part.split(' ')[0].replace(/^\//, '')));
      }
      keptFromPrevious++;
    }
    continue;
  }

  const srcStat = await stat(srcPath);
  srcBytes += srcStat.size;

  const destAbs = path.join(publicDir, item.dest.replace(/^\//, ''));
  const dir = path.dirname(destAbs);
  await mkdir(dir, { recursive: true });
  written.add(destAbs);

  const ext = path.extname(srcPath).toLowerCase();
  const isRaster = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  // The old WordPress path this file came from, for the source map.
  const oldPath = '/wp-content/uploads/' + path
    .relative(path.join(workspace, 'domains', 'valleycity.id', 'public_html',
      'wp-content', 'uploads'), srcPath)
    .split(path.sep).join('/');

  if (!isRaster) {
    // e.g. PDFs — copy verbatim.
    await writeFile(destAbs, await readFile(srcPath));
    manifest[item.dest] = {
      src: item.dest,
      srcset: '',
      width: null,
      height: null,
      type: 'application/pdf',
    };
    sourceMap[item.dest] = { oldPath, ...manifest[item.dest] };
    outBytes += srcStat.size;
    done++;
    continue;
  }

  const image = sharp(srcPath, { animated: false });
  const meta = await image.metadata();
  const originalWidth = meta.width || WIDTHS[WIDTHS.length - 1];

  if (srcStat.size < INLINE_LIMIT && originalWidth <= 400) {
    await sharp(srcPath).webp({ quality: 90 }).toFile(destAbs);
    manifest[item.dest] = {
      src: item.dest,
      srcset: '',
      width: originalWidth,
      height: meta.height ?? null,
      type: 'image/webp',
    };
    sourceMap[item.dest] = { oldPath, ...manifest[item.dest] };
    const s = await stat(destAbs);
    outBytes += s.size;
    done++;
    continue;
  }

  const widths = WIDTHS.filter((w) => w < originalWidth);
  if (!widths.length) widths.push(originalWidth);
  widths.push(originalWidth); // always keep the original width available
  const unique = [...new Set(widths)].sort((a, b) => a - b);
  // The largest variant is written to the bare destination path, so a plain
  // <img src="…webp"> without a srcset still loads a real file — and we do
  // not ship a duplicate of it under a "-<width>" name.
  const largest = unique[unique.length - 1];

  const sources = {};
  for (const width of unique) {
    const target = width === largest
      ? destAbs
      : destAbs.replace(/\.webp$/, `-${width}.webp`);
    await sharp(srcPath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toFile(target);
    const s = await stat(target);
    outBytes += s.size;
    sources[width] = target.replace(publicDir, '');
    written.add(target);
  }

  const srcset = Object.entries(sources)
    .map(([w, p]) => `${p} ${w}w`)
    .join(', ');

  manifest[item.dest] = {
    src: item.dest,
    srcset,
    width: originalWidth,
    height: meta.height ?? null,
    type: 'image/webp',
  };
  sourceMap[item.dest] = { oldPath, ...manifest[item.dest] };

  done++;
  if (done % 20 === 0) {
    process.stdout.write(`  …${done}/${needed.length}\n`);
  }
}

/* --- Derivatives ---------------------------------------------------------

   Crops that a page needs but the library does not contain, produced from an
   asset that is already in it.

   The floor plan is published inside a marketing poster: the drawing on the
   left, an old testimonial and a stock photo on the right. The page should
   show the drawing — not the advert — so the plan is cropped out here.

   design-45-portrait answers D1. The dusk exterior is a 2000×2000 square; on
   a 390×870 hero box `object-fit: cover` therefore keeps 45 % of the width
   and scales it 2.2× — the house was cut off and soft, and what remained of
   the frame was sky. srcset cannot fix that (it only offers widths of the
   same picture), so the phone gets a real 9:16 crop through <source>, chosen
   by looking at five candidate crops side by side (.review/crops.png): this
   one keeps the window wall, the front lawn and a sliver of the valley, with
   the sky left where the scrim can use it.
   ---------------------------------------------------------------------- */

const DERIVATIVES = [
  {
    from: '/media/curated/denah-1.webp',
    to: '/media/curated/denah-45-72.webp',
    crop: { left: 0, top: 170, width: 850, height: 1132 },
    // The poster's navy corner is painted over — the plan itself is white.
    mask: { left: 780, top: 0, width: 70, height: 60 },
  },
  {
    from: '/media/curated/design-45.webp',
    to: '/media/curated/design-45-portrait.webp',
    /* 700x1540 keeps the phone box ratio (394x870 CSS px measured in the
       browser) so `cover` crops nothing further, and gives ~1.8 device px
       per CSS px at DPR 2. The window was picked from a 15-crop contact
       sheet (.review/crops2.png): this one puts the headline over the dark
       fascia and the window wall instead of pale sky, and keeps the lawn,
       the road and the hillside at the left edge. Earlier attempts higher
       up left nothing but roof tiles in the frame. */
    crop: { left: 40, top: 460, width: 700, height: 1540 },
    quality: 82,
  },
  /* Hero "blur + rumah tak terlihat" (12 Nov 2026): foto asli owner hanya
     903/1207 px lebar dan portrait; di box hero landscape 1440x828 ia di-
     upscale 1.6x dan `object-position` lama membuang frame ke langit kosong.
     Crop pita-rumah di bawah memotong langit/paving sehingga rumah mengisi
     frame pada rasio box desktop (~1.74:1), dan varian mobile me-re-encode
     portrait penuh dengan unsharp ringan supaya tajam di DPR 2-3. Jendela
     crop dipilih dari screenshot hero yang benar-benar dilihat. */
  {
    from: '/media/curated/foto-2.webp',
    to: '/media/curated/hero-unit-depan.webp',
    crop: { left: 0, top: 450, width: 1207, height: 700 },
    quality: 85,
    sharpen: { sigma: 1.1, m1: 0.7, m2: 0.35 },
  },
  {
    from: '/media/curated/foto-2.webp',
    to: '/media/curated/hero-unit-depan-mobile.webp',
    crop: { left: 0, top: 0, width: 1207, height: 1600 },
    quality: 85,
    sharpen: { sigma: 1.1, m1: 0.7, m2: 0.35 },
  },
  {
    from: '/media/curated/foto-1.webp',
    to: '/media/curated/hero-unit-carport.webp',
    crop: { left: 0, top: 500, width: 903, height: 520 },
    quality: 85,
    sharpen: { sigma: 1.1, m1: 0.7, m2: 0.35 },
  },
  {
    from: '/media/curated/foto-1.webp',
    to: '/media/curated/hero-unit-carport-mobile.webp',
    crop: { left: 0, top: 0, width: 903, height: 1600 },
    quality: 85,
    sharpen: { sigma: 1.1, m1: 0.7, m2: 0.35 },
  },
];

for (const d of DERIVATIVES) {
  const source = path.join(publicDir, d.from.replace(/^\//, ''));
  if (!existsSync(source)) {
    skipped.push(d.from);
    continue;
  }
  const target = path.join(publicDir, d.to.replace(/^\//, ''));
  let image = sharp(source).extract(d.crop);
  if (d.sharpen) image = image.sharpen(d.sharpen);
  if (d.mask) {
    const white = await sharp({
      create: {
        width: d.mask.width,
        height: d.mask.height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    image = image.composite([{ input: white, left: d.mask.left, top: d.mask.top }]);
  }
  await image.webp({ quality: d.quality ?? 90, effort: 5 }).toFile(target);
  written.add(target);
  const out = await stat(target);
  outBytes += out.size;
  manifest[d.to] = {
    src: d.to,
    srcset: '',
    width: d.crop.width,
    height: d.crop.height,
    type: 'image/webp',
  };
  sourceMap[d.to] = { oldPath: d.from, ...manifest[d.to] };
  done++;
}

await writeFile(
  path.join(dataDir, 'media-manifest.json'),
  JSON.stringify(manifest, null, 1));
await writeFile(
  path.join(dataDir, 'media-source-map.json'),
  JSON.stringify(sourceMap, null, 1));

// Remove files left over from an earlier run (e.g. a width variant that is
// no longer generated) so the deploy only carries what we actually use.
async function prune(dir) {
  let removed = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await prune(full);
      continue;
    }
    if (!written.has(full)) {
      await rm(full);
      removed++;
    }
  }
  return removed;
}

const mediaDir = path.join(publicDir, 'media');
const pruned = await prune(mediaDir);

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`\nimages processed : ${done}/${needed.length}`);
console.log(`kept from previous run (source missing): ${keptFromPrevious}`);
console.log(`skipped (missing): ${skipped.length}`);
console.log(`stale files removed: ${pruned}`);
console.log(`source size      : ${mb(srcBytes)} MB`);
console.log(`output size      : ${mb(outBytes)} MB`);
console.log(`manifest entries : ${Object.keys(manifest).length}`);
if (skipped.length) {
  console.log('\nmissing files:');
  skipped.forEach((s) => console.log('  ' + s));
}
