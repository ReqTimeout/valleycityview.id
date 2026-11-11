/**
 * Contact sheet — one image holding many, so a human can actually look at
 * the media library in a single glance instead of opening 40 files.
 *
 *   node scripts/contact-sheet.mjs <out.png> <width> <cols> name1 name2 ...
 *
 * Names are matched against public/media/curated and public/media.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const [, , outFile, widthArg, colsArg, ...names] = process.argv;
const tile = Number(widthArg ?? 320);
const cols = Number(colsArg ?? 4);
const label = 26;

const roots = ['public/media/curated', 'public/media', 'public/brand'];
const resolve = (name) => {
  for (const root of roots) {
    for (const ext of ['.webp', '.png', '.jpg']) {
      const p = path.join(root, name.endsWith(ext) ? name : name + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
};

const cells = [];
for (const name of names) {
  const p = resolve(name);
  if (!p) {
    console.log(`missing: ${name}`);
    continue;
  }
  const img = await sharp(p).resize(tile, tile, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  cells.push({ name, img });
}

const rows = Math.ceil(cells.length / cols);

const composite = [];
cells.forEach((c, i) => {
  const x = (i % cols) * tile;
  const y = Math.floor(i / cols) * (tile + label);
  composite.push({ input: c.img, left: x, top: y + label });
  composite.push({
    input: Buffer.from(
      `<svg width="${tile}" height="${label}"><text x="4" y="17" font-family="monospace" font-size="13" fill="#fff">${c.name}</text></svg>`,
    ),
    left: x,
    top: y,
  });
});

await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
await sharp({
  create: { width: tile * cols, height: (tile + label) * rows, channels: 4, background: '#1b1b1b' },
})
  .composite(composite)
  .png()
  .toFile(path.resolve(outFile));

console.log(`${cells.length} tile(s) → ${outFile} (${tile * cols}×${(tile + label) * rows})`);
