/**
 * Section-by-section screenshots — the full-page shot of a long landing page
 * is unreadable, so every section is captured on its own.
 *
 *   node scripts/sections.mjs [url] [outDir] [width]
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://127.0.0.1:4322/';
const outDir = path.resolve(process.argv[3] ?? '/tmp/vcv-sections');
const width = Number(process.argv[4] ?? 390);

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

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height: 900 },
  deviceScaleFactor: 1,
  locale: 'id-ID',
});
const page = await context.newPage();
await page.goto(base, { waitUntil: 'networkidle' });

await page.evaluate(async () => {
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 800));
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
});

const targets = await page.evaluate(() => {
  const list = [];
  const seen = new Set();
  document.querySelectorAll('section, header, footer, [data-reveal]').forEach((el) => {
    const id = el.id || el.className.toString().split(' ')[0] || el.tagName;
    if (!id || seen.has(id)) return;
    seen.add(id);
    list.push({ id, top: Math.round(el.getBoundingClientRect().top + window.scrollY) });
  });
  return list;
});

let i = 0;
for (const t of targets) {
  i += 1;
  const name = `${String(i).padStart(2, '0')}-${t.id.replace(/[^a-z0-9-]/gi, '')}`;
  await page.evaluate((y) => window.scrollTo(0, y - 20), t.top);
  await page.waitForTimeout(220);
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    clip: { x: 0, y: 0, width, height: Math.min(900, 1200) },
  });
}

await browser.close();
console.log(`${i} section shots → ${outDir}`);
