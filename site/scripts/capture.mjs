/**
 * Per-viewport capture — the only verifier allowed for visual claims.
 *
 *   node scripts/capture.mjs [baseUrl] [outDir] [--only=name,name] [--viewport=mobile,desktop]
 *
 * Why this exists instead of screenshot.mjs: Playwright's `fullPage: true`
 * resizes the viewport to the whole document before painting. Anything
 * `position: sticky` or `position: fixed` therefore resolves at the wrong
 * offset — the header landed in the middle of every previous shot, and the
 * top of the page came out as a white band. Those renders are not what a
 * human sees, so they cannot be used to judge the design.
 *
 * Here the viewport stays at a real device size and the page is scrolled.
 * Each frame is one screenful as it would actually appear, sticky header and
 * floating dock included.
 *
 * Needs Playwright, which is installed globally on this machine.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

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

// --- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const positional = argv.filter((a) => !a.startsWith('--'));

const base = positional[0] ?? 'http://127.0.0.1:4322';
const outDir = path.resolve(positional[1] ?? '/tmp/vcv-cap');
const only = flag('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wantViewport = flag('viewport', 'mobile,desktop')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Frames beyond this are almost always footer repeats; raise it when auditing
// a long page. 40 frames = 32 screens of content at an 0.8 step.
const maxFrames = Number(flag('max', '40'));

// --- targets ---------------------------------------------------------------

const PAGES = [
  { name: 'home', url: '/' },
  { name: 'blog', url: '/blog/' },
  { name: 'blog-p2', url: '/blog/2/' },
  { name: 'post-harga-cimahi', url: '/blog/harga-rumah-cimahi/' },
  { name: 'post-kpr', url: '/blog/kpr-di-bandung/' },
  { name: 'post-denah', url: '/blog/denah-rumah-summarecon-bandung/' },
  { name: 'kpr', url: '/simulasi-kpr/' },
  { name: 'nup', url: '/nup/' },
  { name: 'sale', url: '/sale/' },
  { name: 'agent', url: '/agent/' },
  { name: 'agent-terms', url: '/agent/terms/' },
  { name: 'agent-alt', url: '/agent/alt/' },
  { name: 'privacy', url: '/privacy/' },
  { name: 'thank-you', url: '/thank-you/' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

const targets = only.length
  ? PAGES.filter((p) => only.includes(p.name))
  : PAGES;
const viewports = VIEWPORTS.filter((v) => wantViewport.includes(v.name));

if (!targets.length) {
  console.error(`--only matched nothing. Known: ${PAGES.map((p) => p.name).join(', ')}`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const manifest = [];
const problems = [];

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    locale: 'id-ID',
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console ${viewport.name}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror ${viewport.name}: ${err.message}`));

  for (const target of targets) {
    const dir = path.join(outDir, target.name, viewport.name);
    await mkdir(dir, { recursive: true });

    const response = await page.goto(base + target.url, { waitUntil: 'networkidle' });
    if (!response || response.status() >= 400) {
      problems.push(`${target.name}/${viewport.name}: HTTP ${response?.status()}`);
      continue;
    }

    // Walk the whole document once so every IntersectionObserver reveal has
    // fired, then return to the top before the first frame.
    //
    // scroll-behavior: smooth is switched off first. With it on, every
    // scrollTo() below is an animation: the frame nominally at scrollY = 0 was
    // captured mid-glide a few dozen pixels down, with the header already
    // flipped to its scrolled state — the homepage hero looked like a white
    // nav bar over a cut-off announce strip.
    await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    });

    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = Math.round(viewport.height * 0.8);

    // Frame 0 is the un-scrolled state — for the homepage that is the header
    // overlay over the hero. The frame at 800px is the scrolled state. Both
    // are called out explicitly so the header can be judged as it behaves.
    const positions = [];
    for (let y = 0; y < docHeight; y += step) positions.push(y);
    if (!positions.includes(800) && docHeight > viewport.height + 800) positions.push(800);
    positions.sort((a, b) => a - b);

    let frames = 0;
    for (const y of positions) {
      if (frames >= maxFrames) break;
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(260);

      const file = `${String(frames).padStart(3, '0')}-y${y}.png`;
      await page.screenshot({ path: path.join(dir, file), fullPage: false });
      manifest.push({
        page: target.name,
        url: target.url,
        viewport: viewport.name,
        frame: frames,
        scrollY: y,
        docHeight,
        file: path.relative(outDir, path.join(dir, file)),
      });
      frames += 1;
    }

    // Structural checks that do not need a human eye.
    const checks = await page.evaluate(() => {
      const broken = [];
      document.querySelectorAll('img').forEach((img) => {
        if (img.complete && img.naturalWidth === 0) {
          broken.push(img.getAttribute('src') || '(no src)');
        }
      });
      return {
        broken,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    if (checks.broken.length) {
      problems.push(`${target.name}/${viewport.name}: broken images ${JSON.stringify(checks.broken)}`);
    }
    if (checks.scrollWidth > checks.innerWidth + 1) {
      problems.push(
        `${target.name}/${viewport.name}: horizontal overflow ${checks.scrollWidth} > ${checks.innerWidth}`,
      );
    }

    console.log(
      `${target.name}/${viewport.name}: ${frames} frame(s), doc ${docHeight} CSS px`,
    );
  }

  await context.close();
}

await browser.close();

/*
  The manifest describes every frame in the folder, not just the ones this run
  produced — `--only` runs would otherwise throw away the index of the frames
  still sitting there. Old rows for the pages just captured are replaced, rows
  for other pages are kept.
*/
const manifestFile = path.join(outDir, 'manifest.json');
let previous = [];
try {
  previous = JSON.parse(await readFile(manifestFile, 'utf-8'));
} catch {
  previous = [];
}
const justCaptured = new Set(targets.map((t) => t.name));
const key = (row) => `${row.viewport}/${row.page}/${String(row.frame).padStart(3, '0')}`;
const merged = [...previous, ...manifest]
  .filter((row) => !justCaptured.has(row.page) || !viewports.some((v) => v.name === row.viewport))
  .concat(manifest)
  .sort((a, b) => key(a).localeCompare(key(b)));
await writeFile(manifestFile, JSON.stringify(merged, null, 2));

console.log(`\ncaptures → ${outDir}`);
console.log(`manifest → ${manifestFile} (${merged.length} frames, ${manifest.length} from this run)`);
if (problems.length) {
  console.log('\nPROBLEMS');
  [...new Set(problems)].forEach((p) => console.log('  - ' + p));
} else {
  console.log('\nno broken images, no horizontal overflow, no console errors');
}
