/**
 * Heading audit — walks every built page and reports the font sizes that
 * actually render for h1 / h2 / h3 / .eyebrow.
 *
 *   node scripts/audit-headings.mjs [baseUrl] [--viewports=mobile,desktop]
 *
 * The rule from 05-vision.md: a heading size comes from its level, never from
 * the section it happens to live in. So the size set for a level should be
 * small and explainable — not one value per page.
 *
 * Two viewports are measured, because a responsive `clamp()` is exactly the
 * case where one viewport proves nothing: the DoD is one size per level per
 * breakpoint, which reads back as two sizes across both. Headings that do not
 * paint (screen-reader-only wrappers, `display: none` breadcrumbs) are skipped
 * — they have no rendered size, and counting them made the audit report a
 * 12px h2 that no human ever sees.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const base = argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4322';
const viewports = (argv.find((a) => a.startsWith('--viewports='))?.split('=')[1] ?? 'mobile,desktop')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '..', 'dist');

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    return require(path.join(root, 'playwright'));
  }
}

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

const { chromium } = loadPlaywright();
const browser = await chromium.launch();

/** `${level}@${viewport}` -> size -> [routes] */
const table = new Map();

for (const vp of viewports) {
  const size = SIZES[vp];
  if (!size) {
    console.error(`unknown viewport "${vp}"`);
    process.exit(1);
  }
  const context = await browser.newContext({ viewport: { ...size }, deviceScaleFactor: 1, locale: 'id-ID' });
  const page = await context.newPage();

  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    const found = await page.evaluate(() => {
      const out = [];
      const push = (level, el) => {
        const cs = getComputedStyle(el);
        // A heading that never paints has no rendered size worth auditing.
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        // The `.sr-only` shape: clipped to nothing by an absolute clip-path.
        if (cs.clipPath !== 'none' || cs.position === 'absolute' && r.height <= 1) return;
        out.push({
          level,
          size: Math.round(parseFloat(cs.fontSize) * 10) / 10,
          selector:
            el.tagName.toLowerCase() +
            (el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : ''),
          text: (el.textContent || '').trim().slice(0, 40),
        });
      };
      document.querySelectorAll('h1').forEach((el) => push('h1', el));
      document.querySelectorAll('h2').forEach((el) => push('h2', el));
      document.querySelectorAll('h3').forEach((el) => push('h3', el));
      document.querySelectorAll('.eyebrow').forEach((el) => push('eyebrow', el));
      return out;
    });

    for (const item of found) {
      const key = `${item.level}@${vp}`;
      if (!table.has(key)) table.set(key, new Map());
      const sizes = table.get(key);
      if (!sizes.has(item.size)) sizes.set(item.size, []);
      sizes.get(item.size).push(`${route}  ${item.selector}  “${item.text}”`);
    }
  }

  await context.close();
}

await browser.close();

console.log(`pages audited: ${routes.length} — viewports: ${viewports.join(', ')}\n`);

const offenders = [];
for (const level of ['h1', 'h2', 'h3', 'eyebrow']) {
  for (const vp of viewports) {
    const sizes = table.get(`${level}@${vp}`);
    if (!sizes) {
      console.log(`${level} (${vp}): (none)`);
      continue;
    }
    const list = [...sizes.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`${level} @ ${vp} — ${list.length} distinct size(s)`);
    if (list.length > 1) offenders.push(`${level} @ ${vp}: ${list.length} sizes`);
    for (const [sz, where] of list) {
      const unique = [...new Set(where)];
      console.log(`  ${sz}px  ×${unique.length}`);
      for (const w of unique.slice(0, 6)) console.log(`      ${w}`);
      if (unique.length > 6) console.log(`      … ${unique.length - 6} more`);
    }
    console.log('');
  }
}

if (offenders.length) {
  console.log(`FAILED — a heading level must have one size per breakpoint:`);
  offenders.forEach((o) => console.log('  - ' + o));
  process.exit(1);
}
console.log('every heading level renders at exactly one size per breakpoint');
