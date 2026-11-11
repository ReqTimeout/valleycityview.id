#!/usr/bin/env node
/**
 * seo/bing-submit.mjs — submit URL ke Bing Webmaster URL Submission API (plan v2 §3.5).
 *
 * Jalan sebagai jalur discovery KEDUA: IndexNow itu real-time ke Bing tapi tidak
 * menjamin crawl; endpoint ini jalur resmi Bing + meng rumored memberi sinyal
 * discovery. Nyatel milhares URL `not_discovered` di GSC (lihat plan §14.4).
 *
 * Kuota free tier (terverifikasi 1 Okt 2026 via GetUrlSubmissionQuota):
 *   100 URL/hari + 3.100/bulan per site. API menerima maks 10 URL per request,
 *   jadi script ini pecah jadi batch 10.
 *
 * Menulis ke `state.json`:
 *   - `bing.submitted[url] = { at, type: 'batch' }` (cooldown 30 hari)
 *   - `bing.lastRun = { at, submitted, skipped, quotaBefore, quotaAfter, failures }`
 *
 * URL WAJIB bentuk canonical trailing slash — valleycity.id canonical selalu `/blog/slug/`.
 * Submit tanpa slash → Bing dapat 308, kuota tetap terpakai, tidak ikut terindeks.
 *
 * Usage:
 *   node seo/bing-submit.mjs              # publish 24 jam terakhir
 *   node seo/bing-submit.mjs --days 7     # window lain
 *   node seo/bing-submit.mjs --all        # semua published
 *   node seo/bing-submit.mjs --limit 90   # batasi (default 90, sisakan kuota)
 *   node seo/bing-submit.mjs --force      # submit ulang walau cooldown 30 hari
 *   node seo/bing-submit.mjs --dry-run    # tampilkan rencana, tanpa POST
 *
 * Env: BING_API_KEY (wajib), BING_SITE_URL (default https://valleycity.id)
 * Exit: 0 = oke (termasuk "tidak ada URL baru"), 1 = gagal total.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { STATE_PATH } from './paths.mjs';

const API = 'https://ssl.bing.com/webmaster/api.svc/json';
const SITE = process.env.BING_SITE_URL || 'https://valleycity.id';
const BATCH_MAX = 10; // batas API: 10 URL per request
const COOLDOWN_DAYS = 30; // submit ulang URL yang sama tidak mempercepat crawl
const DEFAULT_LIMIT = 90; // sisakan kuota daily untuk keperluan lain

function parseArgs(argv) {
  const args = { days: 1, all: false, force: false, dryRun: false, limit: DEFAULT_LIMIT, url: null, urls: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--urls') args.urls = argv[++i];
    else if (a.startsWith('--urls=')) args.urls = a.slice(7);
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  return args;
}

function loadState() {
  if (!existsSync(STATE_PATH)) throw new Error(`state.json tidak ada: ${STATE_PATH}`);
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}

function apiKey() {
  const k = process.env.BING_API_KEY;
  if (!k) throw new Error('BING_API_KEY belum di-set (lihat seo/README.md §5)');
  return k;
}

/** Sisa kuota hari ini. 200 = key hidup + site terdaftar; 403 = key salah/site belum verified. */
async function fetchQuota(key) {
  const url = `${API}/GetUrlSubmissionQuota?siteUrl=${encodeURIComponent(SITE)}&apikey=${key}`;
  const res = await fetch(url);
  const json = await res.json();
  if (res.status !== 200 || !json.d) {
    throw new Error(`GetUrlSubmissionQuota HTTP ${res.status}: ${json.Message || JSON.stringify(json).slice(0, 160)}`);
  }
  return { daily: json.d.DailyQuota ?? 0, monthly: json.d.MonthlyQuota ?? 0 };
}

async function submitBatch(key, urls) {
  const url = `${API}/SubmitUrlbatch?apikey=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ siteUrl: SITE, urlList: urls }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 160) };
  }
  // {"d":null} = 200 diterima. ErrorCode 3 = invalid key.
  return { ok: res.status === 200 && json.d === null, status: res.status, error: json.Message || null };
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const withinDays = (iso, days) => {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? false : Date.now() - t <= days * 86400000;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        'Usage: node seo/bing-submit.mjs [--all | --days N | --url <url>] [--limit N] [--force] [--dry-run]',
        `  --all       semua URL published (default: ${args.days} hari terakhir)`,
        '  --limit N   maks URL yang disubmit (default 90, kuota 100/hari)',
        '  --urls A,B  daftar URL eksplisit (dipakai remedy), dipotong koma',
        '  --force     submit ulang walau masih dalam cooldown 30 hari',
        '  --dry-run   tidak ada POST',
      ].join('\n')
    );
    return 0;
  }

  const state = loadState();
  const published = state.published || [];
  const prior = state.bing?.submitted || {};

  // 1. pilih kandidat
  let candidates;
  if (args.url) {
    candidates = [args.url];
  } else if (args.urls) {
    // daftar eksplisit (dipakai seo/remedy.mjs untuk re-submit selektif)
    candidates = args.urls.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    candidates = published
      .filter((p) => args.all || withinDays(p.firstSeen, args.days))
      .map((p) => p.url)
      .filter(Boolean);
  }
  candidates = [...new Set(candidates)];

  // 2. skip yang belum canonical (harus trailing slash) — submit yang salah = sia-sia
  const malformed = candidates.filter((u) => u.includes('valleycity.id') && !/\/$/.test(u));
  if (malformed.length) {
    console.log(`  ⚠ ${malformed.length} URL tanpa trailing slash dilewati (bukan canonical):`);
    for (const u of malformed) console.log(`    - ${u}`);
  }
  candidates = candidates.filter((u) => !malformed.includes(u));

  // 3. cooldown
  const fresh = candidates.filter((u) => {
    if (args.force || !prior[u]) return true;
    return Date.now() - Date.parse(prior[u].at) > COOLDOWN_DAYS * 86400000;
  });
  const cooled = candidates.length - fresh.length;

  const key = apiKey();
  const quotaBefore = await fetchQuota(key);

  // 4. batasi kuota
  const budget = Math.max(0, Math.min(args.limit, quotaBefore.daily));
  const targets = fresh.slice(0, budget);
  const overQuota = fresh.length - targets.length;

  console.log(`bing-submit — site ${SITE}`);
  console.log(`  kuota hari ini : ${quotaBefore.daily}/100 (bulan ${quotaBefore.monthly}/3100)`);
  console.log(`  kandidat        : ${fresh.length} (cooldown ${cooled} dilewati)`);
  if (overQuota > 0) console.log(`  ⚠ ${overQuota} URL tidak dikirim (melebihi kuota tersisa / --limit)`);
  console.log(`  akan submit     : ${targets.length}\n`);

  if (args.dryRun) {
    for (const u of targets) console.log('  -', u);
    console.log('\n(--dry-run: tidak ada POST)');
    return 0;
  }
  if (!targets.length) {
    console.log('bing-submit: tidak ada URL untuk disubmit');
    return 0;
  }

  // 5. submit per batch 10
  state.bing = state.bing || { submitted: {}, lastRun: null };
  state.bing.submitted = state.bing.submitted || {};

  const submitted = [];
  const failures = [];
  for (const batch of chunk(targets, BATCH_MAX)) {
    const res = await submitBatch(key, batch);
    const label = res.ok ? 'OK  ' : 'FAIL';
    console.log(`  [${label}] ${res.status} ${batch.length} URL${res.error ? ` — ${res.error}` : ''}`);
    for (const u of batch) {
      if (res.ok) {
        state.bing.submitted[u] = { at: new Date().toISOString(), batch: batch.length };
        submitted.push(u);
      } else {
        failures.push({ url: u, status: res.status, error: res.error });
      }
    }
  }

  const quotaAfter = await fetchQuota(key);
  state.bing.lastRun = {
    at: new Date().toISOString(),
    submitted: submitted.length,
    skipped: cooled,
    overQuota,
    quotaBefore: quotaBefore.daily,
    quotaAfter: quotaAfter.daily,
    failures: failures.length,
  };
  saveState(state);

  console.log(`\nsubmitted ${submitted.length} URL · kuota ${quotaBefore.daily} → ${quotaAfter.daily} · state.bing terisi`);
  if (failures.length) {
    console.log(`gagal ${failures.length}: ${JSON.stringify(failures.slice(0, 3))}`);
    console.log(' Troubleshoot: seo/README.md §13.6');
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  });
