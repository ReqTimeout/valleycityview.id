#!/usr/bin/env node
/**
 * seo/publish.mjs — promote draft → build → deploy → IndexNow ping (spec §4).
 *
 * Langkah:
 *   1. Ambil draft terbaik (priority DESC, lama duduk ASC) dari queue status='draft'
 *      yang file Markdown-nya ada + status:draft
 *   2. Flip frontmatter status:publish, set date=now
 *   3. pnpm --filter landing build
 *   4. node seo/llms.mjs (regen llms.txt dari dist/sitemap) + salin ke dist
 *   5. wrangler pages deploy site/dist (env CLOUDFLARE_API_TOKEN + ACCOUNT_ID)
 *   6. indexnow.mjs ping URL baru + update state.json
 *
 * Usage:
 *   node seo/publish.mjs --count=1
 *   node seo/publish.mjs --count=1 --no-deploy   # flip + build saja (review manual)
 *   node seo/publish.mjs --slug=apa-itu-smm-panel # publish spesifik
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn, execFileSync } from 'node:child_process';
import { ROOT, BLOG_DIR, QUEUE_PATH, PUBLIC_DIR } from './paths.mjs';
import { SITE, CF_PROJECT } from './site.mjs';

/**
 * daily_count default dari seo/config.json (ditulis ramp-gate.mjs tiap Senin).
 * `--count=N` eksplisit selalu menang. Kalau config tidak ada → fallback 1
 * (perilaku lama, supaya publish manual tidak ikut berubah diam-diam).
 */
function configuredDailyCount() {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'seo/config.json'), 'utf8'));
    const n = Number(cfg.daily_count);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  } catch {
    return 1;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { count: configuredDailyCount(), noDeploy: false, slug: null, countExplicit: false, skipUniqueness: false };
  for (const a of args) {
    if (a.startsWith('--count=')) {
      // Panjang '--count=' = 8 karakter. Versi lama pakai slice(10) sehingga
      // `--count=1` jadi '' -> parseInt NaN -> pickDrafts melakukan slice(0, NaN)
      // yang hasilnya array KOSONG. Akibatnya --count=N tidak pernah membatasi
      // publish; selalu jatuh ke "Tidak ada draft siap publish" (4 Okt 2026).
      const n = parseInt(a.slice('--count='.length), 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`--count= tidak valid: ${JSON.stringify(a)} (harus angka >= 0)`);
      }
      opts.count = n;
      opts.countExplicit = true;
    } else if (a === '--no-deploy') opts.noDeploy = true;
    else if (a.startsWith('--slug=')) opts.slug = a.slice('--slug='.length);
  }
  if (!opts.countExplicit) console.log(`publish: daily_count dari config.json = ${opts.count} (--count= untuk override)`);
  return opts;
}

// Kandidat dipool lebih besar dari `count` karena gate bisa menolak sebagian.
// Kalau poolnya cuma `count`, satu slug yang diblokir akan menggagalkan SELURUH
// siklus — dan karena slug itu tetap `status: draft` dan tetap prioritas teratas,
// siklus berikutnya mengulang slug yang sama. Itu deadlock: publish mati
// permanen (terjadi 6 Okt 2026, 44 siklus gagal berturut).
const POOL_FACTOR = 12;
const POOL_MIN = 24;

function pickDrafts(queue, count, slug) {
  const now = Date.now();
  const drafts = queue.items.filter((i) => {
    if (i.status !== 'draft') return false;
    // Lewati yang sedang dikarantina gate duplikat.
    if (i.qcBlockedUntil && Number(i.qcBlockedUntil) > now) return false;
    if (slug) return i.slug === slug;
    return existsSync(`${BLOG_DIR}/${i.slug}.md`);
  });
  if (slug) return drafts;
  return drafts
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.notes || '').localeCompare(b.notes || ''))
    .slice(0, Math.max(count * POOL_FACTOR, POOL_MIN));
}

/**
 * Gate anti-duplicate (plan v2 §9 scaled-content-abuse). Dipanggil PER SLUG:
 * corpus penuh memang punya banyak pasangan mirip warisan, jadi kalau global
 * gate akan selalu gagal dan memblokir semua publish. Yang kita tolak hanya
 * slug yang SENDIRI involved dalam pasangan FAIL.
 */
function uniquenessGate(slug) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'seo/qc-uniqueness.mjs'), '--slug', slug, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SEO_NOTIFY_DRYRUN: '1' },
    });
    return { ok: true, detail: null };
  } catch (e) {
    if (e.status === 1) {
      let detail = null;
      try {
        const j = JSON.parse(e.stdout || '{}');
        detail = (j.failsDetail || []).slice(0, 3).map((p) => `${p.b} (score ${p.score})`);
      } catch {}
      return { ok: false, detail };
    }
    // exit 2 = tool error (mis. corpus kosong) → jangan blokir publish, tapi louder
    return { ok: true, detail: null, warn: e.message?.slice(0, 120) };
  }
}

function flipDraft(path) {
  const src = readFileSync(path, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const flipped = src
    .replace(/^status:\s*draft\s*$/m, 'status: publish')
    .replace(/^date:\s*\d{4}-\d{2}-\d{2}\s*$/m, `date: ${today}`);
  if (flipped === src) throw new Error('frontmatter tidak berubah — status:draft tidak ditemukan?');
  writeFileSync(path, flipped);
  return today;
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

async function main() {
  // KUNCI PENGAMAN (6 Okt 2026 — insiden OOM).
  // Skrip ini menjalankan `pnpm build` 1.132 artikel + wrangler deploy. Di dalam
  // container VPS 3,9 GB itu MEMBUNUH server (app.valleycity.id mati + sshd tak bisa fork).
  // Build HANYA boleh di Cloudflare Pages (dari git). Di container, paksa pakai
  // seo/publish-git.mjs. Override darurat: SEO_ALLOW_LOCAL_BUILD=1 (jangan dipakai
  // tanpa persetujuan user + pengawasan load).
  if (existsSync('/.dockerenv') && !process.env.SEO_ALLOW_LOCAL_BUILD) {
    console.error('DITOLAK: build in-container dilarang (insiden OOM 6 Okt 2026).');
    console.error('Pakai: node seo/publish-git.mjs --count=N');
    process.exit(1);
  }
  const opts = parseArgs();
  const queue = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));

  const targets = pickDrafts(queue, opts.count, opts.slug);
  if (!targets.length) {
    console.log('Tidak ada draft siap publish (queue status=draft + file Markdown ada).');
    console.log('Generate dulu: node seo/generate.mjs --count=2');
    process.exit(1);
  }

  // Gate anti-duplicate: sisipkan draft yang mirip artikel existing, lalu publish
  // lagi pakai slot kuota harian dan menjatuhkan index_rate → ramp-gate turun.
  //
  // PENTING: slug yang diblokir TIDAK boleh menggagalkan siklus. Ia dikarantina
  // agar dicoba lagi setelah 7 hari, sementara siklus ini lanjut ke kandidat
  // berikutnya. Gate tetap berkuasa (tanpa --skip-uniqueness) — yang digeser
  // hanya antreanannya, bukan aturannya. Tanpa ini publish mati permanen:
  // 6 Okt 2026 satu slug mirip "beli-followers-tiktok-pontianak" memblokir
  // 44 siklus berturut-turut karena selalu jadi kandidat prioritas teratas.
  const QUARANTINE_MS = 7 * 24 * 3600 * 1000;
  const cleared = [];
  const blockedByGate = [];
  if (!opts.skipUniqueness) {
    console.log(`Gate qc-uniqueness (anti scaled-content-abuse) — ${targets.length} kandidat:`);
    for (const t of targets) {
      if (cleared.length >= opts.count) break; // cukup, sisanya untuk siklus depan
      const g = uniquenessGate(t.slug);
      if (g.warn) console.log(`  ⚠ ${t.slug}: gate error (tidak memblokir) — ${g.warn}`);
      if (g.ok) {
        cleared.push(t);
      } else {
        blockedByGate.push({ t, detail: g.detail || [] });
        console.log(`  ✗ ${t.slug} DITOLAK — mirip: ${(g.detail || []).join(', ')}`);
      }
    }
    if (blockedByGate.length) {
      const until = new Date(Date.now() + QUARANTINE_MS).toISOString().slice(0, 10);
      for (const { t, detail } of blockedByGate) {
        t.qcBlockedUntil = Date.now() + QUARANTINE_MS;
        t.qcBlockedDate = until;
        t.qcBlockCount = (t.qcBlockCount || 0) + 1;
        t.qcBlockedReason = detail.join('; ');
      }
      console.log(
        `\n${blockedByGate.length} slug dikarantina sampai ${until} (percobaan ke-${blockedByGate[0].t.qcBlockCount}). Gate tetap berlaku — tidak ada yang di-skip.`,
      );
      console.log('  → artikel ini harus dirombak (data unik / angle berbeda), bukan di-bypass.');
    }
  } else {
    cleared.push(...targets.slice(0, opts.count));
    console.log('Gate qc-uniqueness: DILEWATI (--skip-uniqueness)');
  }

  if (!cleared.length) {
    // WAJIB tulis queue dulu: kalau tidak, penanda karantina hilang dan siklus
    // berikutnya menguji slug yang sama lagi → deadlock yang baru saja diperbaiki.
    writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');
    console.log('\nSemua kandidat dikarantina gate — tidak ada yang dipublish siklus ini.');
    console.log('Siklus berikutnya akan mencoba kandidat lain. Artikel terkarantina perlu dirombak.');
    process.exitCode = 1;
    return;
  }

  const publishedUrls = [];
  for (const t of cleared) {
    const path = `${BLOG_DIR}/${t.slug}.md`;
    console.log(`\n--- publish ${t.slug} ---`);
    const today = flipDraft(path);
    t.status = 'published';
    t.notes = (t.notes || '').replace(/\s*\|\s*generated[^\n]*/, '').trim();
    t.notes = (t.notes ? t.notes + ' | ' : '') + `published ${today}`;
    publishedUrls.push(`${SITE}/blog/${t.slug}/`);
    console.log(`  status:publish, date:${today}`);
  }

  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');

  // Bangun internal mesh (plan v2 §6.1): menulis related[] ke frontmatter artikel
  // published. HARUS sebelum build supaya link-nya ikut ter-render di HTML.
  // Idempoten (jalankan ulang = 0 perubahan) dan fail-closed kalau related[]
  // menghasilkan duplikat atau pagar frontmatter rusak.
  console.log('\n=== bangun internal mesh (plan v2 §6.1) ===');
  run('node seo/mesh-build.mjs --write');

  // Build
  console.log('\n=== build landing ===');
  run('pnpm --filter landing build');

  // Validasi schema JSON-LD (plan v2 §5.3 "wire post-build"). Fail-CLOSED:
  // schema rusak = halaman tidak bisa dapat rich result, jadi lebih baik
  // deploy tertahan daripada diam-diam merusak produksi.
  console.log('\n=== validasi schema JSON-LD ===');
  try {
    run('node seo/jsonld-validate.mjs --strict');
    console.log('  schema OK (0 error, 0 warning)');
  } catch (e) {
    console.error('\nFATAL: validasi JSON-LD gagal — deploy DIBATASI (schema rusak akan merusak produksi).');
    console.error('  Perbaiki dulu, atau bypass SADARI: --no-deploy lalu deploy manual setelah dicek.');
    throw e;
  }

  // Regen llms.txt + llms-full.txt (reads dist/sitemap-0.xml — must run after build)
  console.log('\n=== llms regen ===');
  run('node seo/llms.mjs');
  // Astro copies public/ at build-time; llms wrote AFTER build → copy to dist manually
  for (const f of ['llms.txt', 'llms-full.txt']) {
    const src = `${PUBLIC_DIR}/${f}`;
    if (existsSync(src)) copyFileSync(src, `${ROOT}/site/dist/${f}`);
  }

  if (opts.noDeploy) {
    console.log('\n--no-deploy: build selesai, deploy manual:');
    console.log('  export CLOUDFLARE_API_TOKEN=…; export CLOUDFLARE_ACCOUNT_ID=<lihat accountcf.md>');
    console.log(`  npx wrangler pages deploy site/dist --project-name ${CF_PROJECT} --branch main --commit-dirty=true`);
    console.log(`  node seo/indexnow.mjs ${publishedUrls.join(' ')}`);
    return;
  }

  // Deploy (butuh env CF — dari accountcf.md, JANGAN hardcode)
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('\nFATAL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID belum di-set (lihat accountcf.md).');
    console.error('Draft sudah di-flip + queue updated. Deploy manual lalu ping:');
    console.error(`  node seo/indexnow.mjs ${publishedUrls.join(' ')}`);
    process.exit(1);
  }
  console.log('\n=== deploy ===');
  run(`npx wrangler pages deploy site/dist --project-name ${CF_PROJECT} --branch main --commit-dirty=true`);

  // IndexNow
  console.log('\n=== indexnow ===');
  const child = spawn('node', [`${ROOT}/seo/indexnow.mjs`, ...publishedUrls], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  child.on('close', (code) => {
    console.log(`\nDone: ${publishedUrls.length} artikel live:`);
    for (const u of publishedUrls) console.log(`  ${u}`);
    process.exit(code || 0);
  });
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
