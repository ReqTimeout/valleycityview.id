/**
 * Crop sheet — candidate portrait windows for a hero, tiled so the choice is
 * made by looking at the photograph instead of by guessing an `object-position`.
 *
 *   node scripts/crop-sheet.mjs <src> <out.png> <ratio> [cols]
 *
 * `src` is relative to site/ (usually public/media/curated/x.webp). `ratio` is
 * height/width of the box the image has to fill on a phone — measured in the
 * browser, not assumed: at 390 CSS px the landing hero media box is 390x743 to
 * 390x963, so 2.0 is close to what a real frame shows.
 *
 * Why this exists: `object-fit: cover` on a square or landscape master inside a
 * tall box keeps the full height and slices the width down the middle. For an
 * exterior render that middle slice is sky, which is how four landing heroes
 * ended up with white copy on a bright blue background at 1.3:1.
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SITE = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(SITE, '..');
const [, , srcArg, outArg, ratioArg, colsArg] = process.argv;
if (!srcArg || !outArg) {
  console.error('usage: node scripts/crop-sheet.mjs <src> <out.png> <ratio> [cols]');
  process.exit(2);
}

const ratio = Number(ratioArg ?? 2);
const cols = Number(colsArg ?? 3);
const tileW = 220;
const tileH = Math.round(tileW * ratio);
const gap = 8;
const label = 20;

const src = path.join(SITE, srcArg);
const meta = await sharp(src).metadata();
const W = meta.width;
const H = meta.height;

// A window is as wide as it can be while holding the requested ratio, so every
// candidate is a real `cover` result and not a letterboxed lie.
const cropW = Math.min(W, Math.round(H / ratio));
const cropH = Math.round(cropW * ratio);

const cells = [];
for (const fy of [0, 0.5, 1]) {
  for (const fx of [0, 0.5, 1]) {
    const left = Math.round((W - cropW) * fx);
    const top = Math.round((H - cropH) * fy);
    const buf = await sharp(src)
      .extract({ left, top, width: cropW, height: cropH })
      .resize(tileW, tileH)
      .png()
      .toBuffer();
    cells.push({ left, top, buf });
  }
}

const rows = Math.ceil(cells.length / cols);
const sheetW = cols * (tileW + gap) + gap;
const sheetH = rows * (tileH + label + gap) + gap;

const composite = [];
for (const [i, c] of cells.entries()) {
  const x = gap + (i % cols) * (tileW + gap);
  const y = gap + Math.floor(i / cols) * (tileH + label + gap);
  composite.push({ input: c.buf, left: x, top: y });
  composite.push({
    input: Buffer.from(
      `<svg width="${tileW}" height="${label}"><text x="0" y="14" font-family="monospace" font-size="12" fill="#94a3b8">x${c.left} y${c.top}</text></svg>`,
    ),
    left: x,
    top: y + tileH,
  });
}

await mkdir(path.dirname(path.join(ROOT, outArg)), { recursive: true });
await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#0b1220' } })
  .composite(composite)
  .png()
  .toFile(path.join(ROOT, outArg));

console.log(`${path.basename(src)} ${W}x${H} → window ${cropW}x${cropH} (ratio ${ratio}) → ${outArg}`);
