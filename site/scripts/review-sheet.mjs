/**
 * Review sheet — tiles arbitrary screenshot paths into one image so a human
 * can look at twelve hero states in a single glance.
 *
 *   node scripts/review-sheet.mjs <out.png> <cols> <cellWidth> <file...>
 *
 * Paths are relative to the repository root. Each tile gets its own path
 * printed under it, trimmed to the part that identifies the page.
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const [, , outFile, colsArg, cellArg, ...files] = process.argv;
const cols = Number(colsArg ?? 3);
const cell = Number(cellArg ?? 380);
const label = 22;

const cells = [];
for (const f of files) {
  const p = path.join(ROOT, f);
  try {
    const img = await sharp(p)
      .resize(cell, Math.round(cell * 2.17), { fit: 'inside' })
      .png()
      .toBuffer({ resolveWithObject: true });
    cells.push({ name: f.replace(/^\.review\/cap\//, ''), img: img.data, w: img.info.width, h: img.info.height });
  } catch (err) {
    console.log(`unreadable: ${f} (${err.message})`);
  }
}

const rows = Math.ceil(cells.length / cols);
const sheetW = cols * (cell + 8) + 8;
const sheetH = rows * (Math.round(cell * 2.17) + label + 8) + 8;

const composite = [];
for (const [i, c] of cells.entries()) {
  const x = 8 + (i % cols) * (cell + 8);
  const y = 8 + Math.floor(i / cols) * (Math.round(cell * 2.17) + label + 8);
  composite.push({ input: c.img, left: x, top: y });
  const short = c.name.length > 46 ? '…' + c.name.slice(-45) : c.name;
  const svg = Buffer.from(
    `<svg width="${cell}" height="${label}"><text x="0" y="15" font-family="monospace" font-size="12" fill="#cbd5e1">${short
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</text></svg>`,
  );
  composite.push({ input: svg, left: x, top: y + c.h });
}

await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#0b1220' } })
  .composite(composite)
  .png()
  .toFile(path.join(ROOT, outFile));

console.log(`${outFile} — ${cells.length} tiles, ${cols}×${rows}`);
