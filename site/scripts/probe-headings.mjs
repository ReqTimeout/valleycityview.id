/**
 * Print the actual heading elements on a few pages, with their rendered size,
 * so an outlier can be located by reading, not by guessing.
 *
 *   node scripts/probe-headings.mjs / /blog/ /blog/harga-rumah-cimahi/ ...
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

const base = 'http://127.0.0.1:4322';
const routes = process.argv.slice(2);

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
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'id-ID' });
const page = await context.newPage();

for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  const found = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('h1,h2,h3').forEach((el) => {
      const cs = getComputedStyle(el);
      out.push({
        tag: el.tagName,
        size: Math.round(parseFloat(cs.fontSize)),
        cls: el.className || '(none)',
        parent: el.parentElement ? el.parentElement.className || el.parentElement.tagName : '',
        text: (el.textContent || '').trim().slice(0, 50),
      });
    });
    return out;
  });
  console.log('### ' + route);
  for (const x of found) {
    console.log(`  ${x.tag} ${String(x.size).padStart(2)}px  .${x.cls}  <${x.parent}>  ${x.text}`);
  }
  console.log('');
}

await browser.close();
