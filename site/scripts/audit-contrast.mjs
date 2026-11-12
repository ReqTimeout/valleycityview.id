/* ==========================================================================
   audit-contrast.mjs — contrast of the hero copy, measured from the capture
   itself (PLAN.md F7: judged from pixels, not from the CSS).

   Lighthouse compares declared CSS colours, gives up when the background is
   an image, and happily scores 100 on a hero a low-vision visitor cannot
   read. This does the opposite: inside the box where the words live it finds
   the letters, works out what is immediately behind each stroke, and reports
   the worst pairings.

   Method, inside --box only:
     1. a separable min filter over relative luminance gives the local floor —
        for light ink on a picture, the picture showing through
     2. a pixel is ink where it is measurably lighter than that floor
     3. every ink pixel gets a WCAG ratio against its own floor
     4. worst 1 % / worst 5 % / median, plus the count of ink pixels so an
        empty or mis-placed box is obvious rather than silently "passing"

   The box is restricted on purpose. Scanned over a whole photograph the same
   rule calls every bright piece of the picture — a sunlit roof beam, a patch
   of sky — "text", and the numbers mean nothing.

     node scripts/audit-contrast.mjs                       # the two homepage frames
     node scripts/audit-contrast.mjs --box .05,.16,.92,.55 ../.review/cap/nup/mobile/000-y0.png

   Exits 1 when the worst 5 % falls below --min (default 3:1, WCAG AA for
   large type; pass 4.5 when the box holds body-size copy). The 1st percentile
   is printed but never gates — see the note by the calculation.
   ========================================================================== */
import sharp from 'sharp';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const argv = process.argv.slice(2);
let min = 3;
let box = null;
let inkMin = 0.82;
const given = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--min') min = Number(argv[++i]);
  else if (argv[i] === '--box') box = argv[++i].split(',').map(Number);
  else if (argv[i] === '--ink-min') inkMin = Number(argv[++i]);
  else given.push(argv[i]);
}

/* Where the copy sits in each hero at scrollY = 0, read off the captures.
   Fractions of the frame, kept as tight as the words allow — the desktop
   homepage hero has a bright corrugated canopy immediately above the
   headline, and including it reports roof panels as if they were letters.

   The four landing heroes have a different box on a phone because a phone
   shows the photograph as a band above the copy: the box starts where that
   band ends (40svh or 44svh of image, plus the 72px header). */
const PRESETS = {
  /* 13 Nov: hero dibersihkan — copy sekarang duduk melendok di bawah
     (diukur via Playwright: eyebrow 442, judul 486-605, tombol 621-682
     CSS pada viewport 844). Box lama .185-.49 menangkap langit foto yang
     sudah tidak ada tulisannya dan melewatkan judul yang sebenarnya. */
  '.review/cap/home/mobile/000-y0.png': [0.02, 0.52, 0.96, 0.82],
  '.review/cap/home/desktop/000-y0.png': [0.11, 0.33, 0.48, 0.6],
  '.review/cap/nup/mobile/000-y0.png': [0.05, 0.54, 0.95, 0.99],
  '.review/cap/sale/mobile/000-y0.png': [0.05, 0.5, 0.95, 0.99],
  '.review/cap/agent/mobile/000-y0.png': [0.05, 0.5, 0.95, 0.99],
  '.review/cap/agent-alt/mobile/000-y0.png': [0.05, 0.5, 0.95, 0.99],
  '.review/cap/nup/desktop/000-y0.png': [0.05, 0.4, 0.46, 0.92],
  '.review/cap/sale/desktop/000-y0.png': [0.05, 0.32, 0.46, 0.92],
  '.review/cap/agent/desktop/000-y0.png': [0.05, 0.4, 0.46, 0.92],
  '.review/cap/agent-alt/desktop/000-y0.png': [0.05, 0.36, 0.5, 0.92],
};

const files = given.length
  ? given
  : Object.keys(PRESETS);

const RADIUS = 5; // 11 px window — smaller than a display stroke, larger than an anti-aliased edge
const INK_DELTA = 0.2; // lighter than the local floor by this much ⇒ ink
/* And bright in absolute terms. Without this the rule cannot tell a white
   letter from a sunlit roof beam or a patch of dusk sky, and the "worst"
   letters it reports are pieces of the photograph. */

const toLinear = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

/** Separable min filter over relative luminance. */
function minFilter(src, w, h) {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let k = -RADIUS; k <= RADIUS; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const v = src[y * w + xx];
        if (v < m) m = v;
      }
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = Infinity;
      for (let k = -RADIUS; k <= RADIUS; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        const v = tmp[yy * w + x];
        if (v < m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

let failures = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    console.log(`FAIL ${rel} — no such capture`);
    failures++;
    continue;
  }
  const rect = box ?? PRESETS[rel];
  if (!rect) {
    console.log(`??   ${rel} — no preset box; pass --box x0,y0,x1,y1`);
    failures++;
    continue;
  }

  const { data, info } = await sharp(abs).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;

  const lum = new Float64Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += ch) {
    lum[i] = 0.2126 * toLinear(data[p]) + 0.7152 * toLinear(data[p + 1]) + 0.0722 * toLinear(data[p + 2]);
  }
  const floor = minFilter(lum, W, H);

  const [x0f, y0f, x1f, y1f] = rect;
  const x0 = Math.round(x0f * W), x1 = Math.round(x1f * W);
  const y0 = Math.round(y0f * H), y1 = Math.round(y1f * H);

  const ratios = [];
  let worst = { r: Infinity, x: 0, y: 0 };
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      const bg = floor[i];
      if (lum[i] < inkMin || lum[i] - bg <= INK_DELTA) continue;
      const r = (lum[i] + 0.05) / (bg + 0.05);
      ratios.push(r);
      if (r < worst.r) worst = { r, x, y };
    }
  }

  if (ratios.length < 500) {
    console.log(`FAIL ${rel} — only ${ratios.length} ink px in the box; wrong coordinates`);
    failures++;
    continue;
  }

  ratios.sort((a, b) => a - b);
  const at = (q) => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * q))];
  const p1 = at(0.01);
  const p5 = at(0.05);
  const median = at(0.5);
  /* The gate is the 5th percentile, not the worst pixel, and the reason is
     worth keeping in mind before believing any number here: a bright roof
     panel next to a dark rib satisfies "light pixel, dark local floor"
     exactly as a white letter does. In the desktop hero the dimmest 1 % is
     the canopy, not the copy. p1 is printed anyway — when it moves, look at
     the frame before reacting. */
  const ok = p5 >= min;
  if (!ok) failures++;

  console.log(`${ok ? 'ok  ' : 'FAIL'} ${rel}`);
  console.log(
    `       ${ratios.length.toLocaleString()} ink px · worst 5% ${p5.toFixed(2)}:1 · ` +
    `median ${median.toFixed(2)}:1 (needs ${min}:1) · worst 1% ${p1.toFixed(2)}:1 ` +
    `at x${worst.x} y${worst.y} — check it is a letter`
  );
}

if (failures) {
  console.log(`\n${failures} frame(s) below ${min}:1`);
  process.exit(1);
}
