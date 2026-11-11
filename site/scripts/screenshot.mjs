/**
 * @deprecated Do not use this to judge the design. It captures with
 * `fullPage: true`, which makes Playwright resize the viewport to the whole
 * document — sticky and fixed elements then render at the wrong offset, so
 * the output is not what a human sees. Use `capture.mjs` instead; it keeps a
 * real device viewport and scrolls. Only the structural checks below (broken
 * images, overflow, heading sizes) remain useful.
 *
 * Visual check — screenshots the built site at the two widths the design is
 * drawn for.
 *
 *   node scripts/screenshot.mjs [baseUrl] [outDir]
 *
 * Needs Playwright. It is installed globally on this machine, so the script
 * falls back to the global module folder when it is not in this project.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://127.0.0.1:4322';
const outDir = path.resolve(process.argv[3] ?? '/tmp/vcv-shots');

console.warn(
  'DEPRECATED: screenshot.mjs captures with fullPage:true, which misrenders\n' +
    'sticky/fixed elements. Use scripts/capture.mjs for anything visual.\n',
);

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

const PAGES = [
  { name: 'home', url: '/' },
  { name: 'blog', url: '/blog/' },
  { name: 'kpr', url: '/simulasi-kpr/' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    locale: 'id-ID',
  });
  const page = await context.newPage();

  for (const target of PAGES) {
    await page.goto(base + target.url, { waitUntil: 'networkidle' });
    // Trigger every scroll reveal before the shot.
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 600));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
    });

    await page.screenshot({
      path: path.join(outDir, `${target.name}-${viewport.name}.png`),
      fullPage: false,
    });

    const report = await page.evaluate(() => {
      const out = { brokenImages: [], sizes: {}, overflow: null };
      const inView = (el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight;
      };
      document.querySelectorAll('img').forEach((img) => {
        // Lazy images below the fold are not loaded yet — that is not a break.
        const loaded = img.complete && img.naturalWidth > 0;
        if (!loaded && (img.loading === 'eager' || inView(img))) {
          out.brokenImages.push(img.getAttribute('src') || '(no src)');
        }
      });
      out.sizes.h2s = [...document.querySelectorAll('main h2')].map((h) =>
        Math.round(parseFloat(getComputedStyle(h).fontSize)),
      );
      out.sizes.eyebrows = [...document.querySelectorAll('main .eyebrow')].map((h) =>
        Math.round(parseFloat(getComputedStyle(h).fontSize)),
      );
      out.overflow =
        document.documentElement.scrollWidth > window.innerWidth
          ? { scrollWidth: document.documentElement.scrollWidth, inner: window.innerWidth }
          : null;
      return out;
    });

    if (report.brokenImages.length) {
      problems.push(
        `${target.name}/${viewport.name}: broken images ${JSON.stringify(report.brokenImages)}`,
      );
    }
    if (report.overflow) {
      problems.push(`${target.name}/${viewport.name}: horizontal overflow ${JSON.stringify(report.overflow)}`);
    }
    if (new Set(report.sizes.h2s).size > 1) {
      problems.push(`${target.name}/${viewport.name}: mixed h2 sizes ${JSON.stringify(report.sizes.h2s)}`);
    }
    if (new Set(report.sizes.eyebrows).size > 1) {
      problems.push(
        `${target.name}/${viewport.name}: mixed eyebrow sizes ${JSON.stringify(report.sizes.eyebrows)}`,
      );
    }
  }

  await context.close();
}

await browser.close();

console.log(`screenshots → ${outDir}`);
if (problems.length) {
  console.log('\nPROBLEMS');
  problems.forEach((p) => console.log('  - ' + p));
} else {
  console.log('\nno broken images, no overflow, heading sizes consistent');
}
