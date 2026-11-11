/**
 * Scroll budget — the guard behind PLAN.md F9 ("mobile-first, jangan banyak
 * scroll ke bawah") so that it stays a measurement instead of a taste call.
 *
 *   node scripts/audit-scroll.mjs [baseUrl] [--viewport=mobile,desktop]
 *
 * Reads scripts/scroll-budget.json, walks each route at a fixed viewport,
 * waits for every reveal animation to fire so lazy sections are at their real
 * height, then compares `document.documentElement.scrollHeight` — in CSS
 * pixels — against the budget. Any route over its number exits 1.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

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

const argv = process.argv.slice(2);
const base = argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4322';
const wantViewport = (
  argv.find((a) => a.startsWith('--viewport='))?.split('=')[1] ?? 'mobile,desktop'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const budget = JSON.parse(
  await readFile(new URL('./scroll-budget.json', import.meta.url), 'utf-8'),
);

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

const browser = await chromium.launch();
const rows = [];
const over = [];

for (const name of wantViewport) {
  const size = VIEWPORTS[name];
  if (!size) {
    console.error(`unknown viewport "${name}"`);
    process.exit(1);
  }
  const table = budget[name] || {};

  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    locale: 'id-ID',
  });
  const page = await context.newPage();

  for (const [route, limit] of Object.entries(table)) {
    const response = await page.goto(base + route, { waitUntil: 'networkidle' });
    if (!response || response.status() >= 400) {
      over.push(`${name} ${route}: HTTP ${response?.status()}`);
      rows.push({ name, route, height: null, limit, note: `HTTP ${response?.status()}` });
      continue;
    }

    // Reveal-on-scroll sections are height-accurate only once they have been
    // through the viewport, so walk the document before measuring.
    //
    // The smooth-scroll switch is not cosmetic: with `scroll-behavior: smooth`
    // every scrollTo() below is an animation, so the walk lags behind the loop
    // and the last sections never actually enter the viewport.
    await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 300));
    });

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const screens = (height / size.height).toFixed(1);
    rows.push({ name, route, height, limit, note: `${screens} screens` });
    if (height > limit) {
      over.push(`${name} ${route}: ${height} > ${limit} CSS px (+${height - limit})`);
    }
  }

  await context.close();
}

await browser.close();

const pad = (s, n) => String(s).padEnd(n);
let last = '';
for (const r of rows) {
  if (r.name !== last) {
    console.log(`\n${r.name.toUpperCase()} (${VIEWPORTS[r.name].width}x${VIEWPORTS[r.name].height})`);
    console.log(`  ${pad('route', 34)} ${pad('CSS px', 9)} ${pad('budget', 9)} screens`);
    last = r.name;
  }
  console.log(
    `  ${pad(r.route, 34)} ${pad(r.height ?? '-', 9)} ${pad(r.limit, 9)} ${r.note}` +
      (r.height > r.limit ? '   ← OVER' : ''),
  );
}

if (over.length) {
  console.log(`\nFAILED — ${over.length} route(s) over budget:`);
  over.forEach((o) => console.log('  - ' + o));
  console.log('\nThe fix is compression, not deletion: fold long blocks into');
  console.log('<details>, go two-column earlier, drop redundant repeats.');
  process.exit(1);
}
console.log('\nevery audited route is inside its scroll budget');
