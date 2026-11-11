/**
 * Metadata probe for the curated set — the evidence behind the foto/render
 * classification in optimize-media.mjs.
 *
 *   node scripts/media-meta.mjs [name ...]
 *
 * A photo straight out of a camera carries EXIF (make, model, exposure).
 * A render or an AI export usually carries none, or only a software tag.
 * That is the one machine-checkable difference between the two, and it is
 * what the label rule (PLAN.md F6) needs.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const dir = path.resolve('public/media/curated');
const names = process.argv.slice(2);
const all = names.length
  ? names
  : (await import('node:fs')).readdirSync(dir).filter((f) => f.endsWith('.webp'));

for (const f of all) {
  const m = await sharp(path.join(dir, f)).metadata();
  const exif = m.exif
    ? Buffer.from(m.exif).toString('latin1').match(/(Canon|Nikon|SONY|samsung|Xiaomi|Realme|OPPO|HUAWEI|iPhone|Google)/gi)
    : null;
  const software = m.xmp?.length
    ? 'xmp'
    : m.exif
      ? 'exif'
      : m.icc ? 'icc-only' : 'bare';
  console.log(
    f.replace('.webp', '').padEnd(18),
    `${m.width}x${m.height}`.padEnd(12),
    software.padEnd(10),
    exif ? [...new Set(exif)].join(',') : '',
  );
}
