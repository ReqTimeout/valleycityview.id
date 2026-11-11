/**
 * JS budget — the guard behind the vision's "no more than 60 KB of gzip
 * JavaScript on a page".
 *
 *   node scripts/audit-js.mjs [baseUrl] [--limit=61440]
 *
 * Reads scripts/js-budget.json, walks every built route, scrolls the page so
 * the `client:visible` chunks (gallery lightbox, mobile dock) actually load,
 * then sums the gzip size of every .js file the browser pulled down. A page
 * over the limit exits 1.
 *
 * The size is measured from the file on disk in dist/, not from the network:
 * a local preview server does not gzip, so transferSize would report the raw
 * bytes and flatter the page. What a real CDN ships is the gzip of the same
 * file, so that is what is counted here.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

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
const budget = JSON.parse(
  await readFile(new URL('./js-budget.json', import.meta.url), 'utf-8'),
);
const limit = Number(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? budget.limit);

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '..', 'dist');

/** Every .html file in dist/, as a site-relative URL. */
async function collectRoutes(dir = distDir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRoutes(full, out);
    } else if (entry.name.endsWith('.html')) {
      const rel = path.relative(distDir, full);
      out.push('/' + rel.replace(/index\.html$/, '').replace(/\.html$/, ''));
    }
  }
  return out;
}

const routes = (await collectRoutes()).sort();

/** gzip size of a dist file addressed by its site-relative URL. */
async function gzipSizeOf(url) {
  let file;
  try {
    file = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (!file.endsWith('.js')) return null;
  const abs = path.join(distDir, file);
  try {
    return gzipSync(await readFile(abs)).length;
  } catch {
    // A JS URL that is not under dist/ (an inline module, a third-party CDN)
    // is not ours to budget here; count it only if it lands in dist.
    return null;
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});

const rows = [];
const over = [];

for (const route of routes) {
  const page = await context.newPage();
  const jsUrls = new Set();
  page.on('response', (res) => {
    const url = res.url();
    if (new URL(url).pathname.endsWith('.js')) jsUrls.add(url);
  });

  await page.goto(base + route, { waitUntil: 'networkidle' });
  // Scroll the whole document so client:visible / client:idle chunks hydrate
  // and their script tags are actually requested before we measure.
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 250));
  });
  await page.waitForLoadState('networkidle');

  let total = 0;
  const files = [];
  for (const url of jsUrls) {
    const size = await gzipSizeOf(url);
    if (size === null) continue;
    total += size;
    files.push({ name: new URL(url).pathname.split('/').pop(), size });
  }
  files.sort((a, b) => b.size - a.size);

  const kb = (total / 1024).toFixed(1);
  rows.push({ route, total, kb, files });
  if (total > limit) {
    over.push(`${route}: ${kb} KB gzip > ${(limit / 1024).toFixed(0)} KB`);
  }
  await page.close();
}

await context.close();
await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(`routes audited: ${rows.length} — limit ${(limit / 1024).toFixed(0)} KB gzip\n`);
for (const r of [...rows].sort((a, b) => b.total - a.total)) {
  const top = r.files.slice(0, 3).map((f) => `${f.name} ${(f.size / 1024).toFixed(1)}`).join(', ');
  console.log(`  ${pad(r.route, 34)} ${pad(r.kb + ' KB', 9)} ${pad('[' + r.files.length + ' js]', 8)} ${top}`);
}

if (over.length) {
  console.log(`\nFAILED — ${over.length} route(s) over the JS budget:`);
  over.forEach((o) => console.log('  - ' + o));
  process.exit(1);
}
console.log(`\nevery route loads at most ${(Math.max(...rows.map((r) => r.total)) / 1024).toFixed(1)} KB gzip — inside the ${limit / 1024} KB budget`);
