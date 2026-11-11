#!/usr/bin/env node
/**
 * seo/gsc-inspect.mjs — URL Inspection batch via GSC (plan v2 §3.2 / §3.3).
 *
 * Sumber URL: `seo/state.json` → `published[]`. Default = URL yang publish
 * dalam 7 hari terakhir (rolling window, biar hemat kuota). `--all` untuk semua.
 * Hasil ditulis ke `state.json`:
 *   - `gsc.inspections[url]` = { verdict, coverageState, indexingState,
 *     robotsTxtState, lastCrawlTime, pageFetchState, crawledAs, checkedAt }
 *   - `published[].indexed`      = 'indexed' | 'not_indexed' | 'blocked' | 'unknown'
 *   - `published[].lastChecked`  = ISO timestamp
 *
 * Rate-limit internal 200ms/request ( Search Console API 600/menit, 2.000/hari;
 * angka ini 10-50 URL/hari jadi jauh di bawah batas — lihat GOOGLE_CLOUD_SETUP §9).
 *
 * Usage:
 *   node seo/gsc-inspect.mjs                 # publish 7 hari terakhir
 *   node seo/gsc-inspect.mjs --all           # semua URL published
 *   node seo/gsc-inspect.mjs --days 30       # window lain
 *   node seo/gsc-inspect.mjs --url https://valleycity.id/blog/foo/   # single URL
 *   node seo/gsc-inspect.mjs --dry-run       # tampilkan URL, tanpa API call
 *   node seo/gsc-inspect.mjs --force         # inspect ulang walau baru dicek <24h
 *
 * Env: GSC_SERVICE_ACCOUNT_JSON_B64 | GSC_SA_FILE | GSC_SITE_URL (lihat seo/lib/gsc.mjs)
 * Exit: 0 = selesai (ada URL belum terindeks itu NORMAL, bukan error),
 *       1 = gagal total (auth/network/state tidak bisa ditulis).
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_PATH } from './paths.mjs';
import { inspectUrl, toStateEntry, isIndexed, SITE_URL, sleep } from './lib/gsc.mjs';

const REFRESH_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = { days: 7, all: false, url: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  return args;
}

function loadState() {
  if (!existsSync(STATE_PATH)) throw new Error(`state.json tidak ada: ${STATE_PATH} (jalankan seo/bootstrap-state.mjs dulu)`);
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

/** Tulis atomik supaya state.json tidak korup kalau proses mati di tengah. */
function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}

const daysAgo = (iso, days) => {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? false : Date.now() - t <= days * 86400000;
};

/**
 * verdict + coverageState → label ringkas untuk state.published[].indexed.
 * PENTING: `*_STATE_UNSPECIFIED` berarti Google tidak punya data sama sekali
 * (URL belum pernah ditemukan) — itu BUKAN "blocked". Hanya DISALLOWED yang
 * benar-benar blocked.
 */
function label(status) {
  if (!status) return 'unknown';
  const coverage = String(status.coverageState || '');
  if (status.robotsTxtState === 'DISALLOWED') return 'blocked';
  if (isIndexed(status)) return 'indexed';
  if (/excluded|blocked/i.test(coverage)) return 'blocked';
  if (/unknown to Google/i.test(coverage)) return 'not_discovered';
  if (/not indexed/i.test(coverage)) return 'not_indexed';
  if (status.verdict && status.verdict !== 'PASS') return 'not_indexed';
  return 'unknown';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs_usage());
    return 0;
  }

  const state = loadState();
  const published = state.published || [];
  if (!published.length) {
    console.log('gsc-inspect: state.published kosong — tidak ada URL untuk di-inspect');
    return 0;
  }

  let targets;
  if (args.url) {
    targets = [{ url: args.url }];
  } else {
    targets = published.filter((p) => args.all || daysAgo(p.firstSeen, args.days));
  }

  // Skip yang baru dicek < 24 jam lalu ( kecuali --force)
  const fresh = state.gsc?.inspections || {};
  if (!args.force && !args.url) {
    const before = targets.length;
    targets = targets.filter((t) => {
      const prev = fresh[t.url];
      return !prev?.checkedAt || Date.now() - Date.parse(prev.checkedAt) > REFRESH_MS;
    });
    if (before !== targets.length) console.log(`  skip ${before - targets.length} URL (sudah dicek <24j, pakai --force untuk ulang)`);
  }

  if (!targets.length) {
    console.log('gsc-inspect: tidak ada URL baru untuk dicek');
    return 0;
  }

  console.log(`gsc-inspect — site ${SITE_URL} · ${targets.length} URL\n`);
  if (args.dryRun) {
    for (const t of targets) console.log('  -', t.url);
    console.log('\n(--dry-run: tidak ada API call, tidak ada penulisan state)');
    return 0;
  }

  state.gsc = state.gsc || { inspections: {}, lastRun: null };
  state.gsc.inspections = state.gsc.inspections || {};

  let indexed = 0;
  const failures = [];

  for (const [i, t] of targets.entries()) {
    try {
      const status = await inspectUrl(t.url);
      const entry = toStateEntry(status);
      const tag = label(status);
      if (tag === 'indexed') indexed++;
      entry.checkedAt = new Date().toISOString();
      state.gsc.inspections[t.url] = entry;

      const pub = published.find((p) => p.url === t.url);
      if (pub) {
        pub.indexed = tag;
        pub.lastChecked = entry.checkedAt;
      }

      console.log(`  [${i + 1}/${targets.length}] ${tag.padEnd(11)} ${status?.coverageState || 'NO DATA'} — ${t.url}`);
    } catch (e) {
      failures.push({ url: t.url, error: e.message });
      console.log(`  [${i + 1}/${targets.length}] ERROR       ${e.message.slice(0, 120)}`);
    }
    if (i < targets.length - 1) await sleep(200);
  }

  const rate = targets.length ? indexed / targets.length : 0;
  state.gsc.lastRun = {
    at: new Date().toISOString(),
    inspected: targets.length,
    indexed,
    indexRate: Number(rate.toFixed(4)),
    failures: failures.length,
  };

  saveState(state);

  console.log(`\nindex_rate: ${indexed}/${targets.length} = ${(rate * 100).toFixed(1)}%  → state.json (gsc.lastRun)`);
  if (failures.length) {
    console.log(`gagal: ${failures.length} URL (lihat pesan di atas)`);
    console.log(' Troubleshoot: seo/README.md §13');
    return 1;
  }
  if (rate < 0.7 && targets.length >= 3) {
    console.log('⚠ rate < 70% — ramp-gate akan menurunkan daily_count (lihat seo/ramp-gate.mjs)');
  }
  return 0;
}

function fs_usage() {
  return [
    'Usage: node seo/gsc-inspect.mjs [--all | --days N | --url <url>] [--dry-run] [--force]',
    '  --all       inspect semua URL published',
    '  --days N    window publish terakhir (default 7)',
    '  --url URL   inspect 1 URL',
    '  --dry-run   tampilkan URL tanpa API call',
    '  --force     ulang walau dicek <24 jam lalu',
  ].join('\n');
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  });
