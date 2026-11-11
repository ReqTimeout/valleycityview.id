/**
 * Screenshot one element of a page, by selector.
 *
 *   node scripts/shot.mjs <url> <selector> <outFile> [width] [maxHeight]
 *
 * The element is scrolled into the viewport and captured with a clip in
 * viewport coordinates. `fullPage` is deliberately not used: it resizes the
 * viewport to the whole document, which misrenders sticky/fixed elements and
 * produces a picture nobody actually sees.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const [, , url, selector, outFile, widthArg, maxHeightArg] = process.argv;
const width = Number(widthArg ?? 390);
const maxHeight = Number(maxHeightArg ?? 1600);
const viewportHeight = Math.max(900, maxHeight);

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    return require(path.join(root, 'playwright'));
  }
}
const { chromium } = loadPlaywright();

await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height: viewportHeight },
  deviceScaleFactor: 1,
  locale: 'id-ID',
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });

await page.evaluate(async () => {
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 900));
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
});

const box = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
}, selector);

if (!box) {
  console.error(`selector not found: ${selector}`);
  process.exit(1);
}

const height = Math.min(Math.round(box.h), maxHeight);

// Bring the top of the element to the top of the viewport, then clip in
// viewport space. The fixed header stays where a real reader sees it.
await page.evaluate((top) => window.scrollTo(0, top), Math.max(0, box.y));
await page.waitForTimeout(500);

const clipTop = Math.max(0, box.y - (await page.evaluate(() => window.scrollY)));
await page.screenshot({
  path: path.resolve(outFile),
  clip: {
    x: Math.max(0, Math.round(box.x)),
    y: clipTop,
    width: Math.min(Math.round(box.w), width),
    height: Math.min(height, viewportHeight - clipTop),
  },
});

await browser.close();
console.log(`${selector} → ${outFile} (${Math.round(box.w)}×${height}, doc ${Math.round(box.h)})`);
