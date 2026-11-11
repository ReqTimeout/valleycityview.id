#!/usr/bin/env node
/**
 * seo/remedy.mjs — otomatis괄 remedi untuk URL yang tidak terindeks (plan v2 §3.1/§3.2).
 *
 * Membaca hasil `seo/gsc-inspect.mjs` di `state.json.gsc.inspections` lalu
 * memutuskan per URL:
 *
 *   indexed          → sehat. Reset riwayat remedi.
 *   not_indexed      → "Crawled – currently not indexed": re-ping IndexNow,
 *                      re-submit ke Bing (kalau cooldown 30 hari sudah lewat),
 *                      tunggu `recheckDays` (default 7) sebelum siklus berikutnya.
 *   not_discovered   → "URL is unknown to Google": masalah DISCOVERY, bukan
 *                      kualitas. Re-ping IndexNow + submit ulang sitemap ke GSC.
 *                      TETAP tidak menurunkan daily_count (itu urusan ramp-gate).
 *   blocked          → robots/noindex → BUTUH MANUSIA (perbaiki robots.txt atau
 *                      meta tag). Tidak ada yang bisa dicoba otomatis.
 *   unknown          → belum ada verdict → tunggu inspeksi berikutnya.
 *
 * Setelah `maxAttempts` siklus gagal → `needsHuman: true` + alert, supaya
 * `runner/lib/notify.mjs` (Stage 3) bisa kirim email, dan URL ditandai supaya
 * tidak diproses lagi diam-diam.
 *
 * Semua ping dijalankan sebagai SUBPROCESS (`indexnow.mjs` / `bing-submit.mjs`),
 * bukan import — script `seo/*.mjs` punya side-effect di top-level.
 *
 * Menulis ke `state.json`:
 *   - `remedy[url] = { attempts, lastAction, actions[], nextCheckAt, needsHuman, note }`
 *   - `remedyAlert` = { level, code, msg, urls[] }  → dibaca notify.mjs
 *
 * Usage:
 *   node seo/remedy.mjs                # siklus remedi
 *   node seo/remedy.mjs --dry-run      # tampilkan rencana, tidak ping/tulis
 *   node seo/remedy.mjs --force        # abaikan nextCheckAt (recheck paksa)
 *   node seo/remedy.mjs --max-pings 10 # cap ping Bing per siklus (default 10)
 *   node seo/remedy.mjs --json         # ringkasan JSON
 *
 * Env: SOCIO_INDEXNOW_KEY (atau site/public/indexnow.txt) · BING_API_KEY ·
 *      GSC_SERVICE_ACCOUNT_JSON_B64 | GSC_SA_FILE (untuk submit sitemap)
 * Exit: 0 = siklus selesai (needsHuman bukan error — itu situasi yang perlu
 *       escalate ke manusia, bukan crash), 1 = gagal total.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { STATE_PATH } from './paths.mjs';
import { submitSitemap, SITE_URL } from './lib/gsc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  recheckDays: 7, // plan: "tunggu 7 hari" sebelum siklus berikutnya
  maxAttempts: 3, // setelah ini → needsHuman
  bingCooldownDays: 30, // sama dengan cooldown bing-submit.mjs
  sitemapResubmitHours: 24, // jangan submit ulang sitemap tiap jam
  maxPings: 10, // cap re-submit Bing per siklus
};

function parseArgs(argv) {
  const args = { dryRun: false, force: false, json: false, maxPings: DEFAULTS.maxPings };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--json') args.json = true;
    else if (a === '--max-pings') args.maxPings = Number(argv[++i]);
    else if (a === '--recheck-days') args.recheckDays = Number(argv[++i]);
    else if (a === '--max-attempts') args.maxAttempts = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  return args;
}

const DAY = 86400000;
const now = () => Date.now();

// Env override hanya untuk pengujian skenario (tidak dipakai di produksi).
const STATE = process.env.SEO_STATE_PATH || STATE_PATH;

function loadState() {
  if (!existsSync(STATE)) throw new Error(`state.json tidak ada: ${STATE}`);
  return JSON.parse(readFileSync(STATE, 'utf8'));
}

function saveState(state) {
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE);
}

function run(script, argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, script), ...argv], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
    child.on('error', (e) => resolve({ code: 1, error: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

/** Status yang perlu diberi tindakan otomatis. */
const ACTIONABLE = new Set(['not_indexed', 'not_discovered']);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        'Usage: node seo/remedy.mjs [--dry-run] [--force] [--max-pings N] [--recheck-days N] [--max-attempts N] [--json]',
        '  --dry-run        tidak ping, tidak tulis state',
        '  --force          abaikan nextCheckAt (recheck paksa sekarang)',
      ].join('\n')
    );
    return 0;
  }

  const recheckDays = args.recheckDays ?? DEFAULTS.recheckDays;
  const maxAttempts = args.maxAttempts ?? DEFAULTS.maxAttempts;
  const state = loadState();
  const published = state.published || [];
  const inspections = state.gsc?.inspections || {};
  state.remedy = state.remedy || {};

  console.log(`remedy — ${args.dryRun ? 'DRY-RUN' : 'LIVE'} · ${published.length} URL published · recheck ${recheckDays} hari · maxAttempts ${maxAttempts}\n`);

  const buckets = { healthy: 0, actionable: 0, waiting: 0, blocked: 0, unknown: 0 };
  const plan = []; // { url, label, reason, actions[] }
  const needHuman = [];

  for (const p of published) {
    const url = p.url;
    if (!url) continue;
    const label = p.indexed || 'unknown';
    const prev = state.remedy[url] || { attempts: 0, actions: [], needsHuman: false };

    if (label === 'indexed') {
      buckets.healthy++;
      if (prev.attempts || prev.needsHuman) {
        state.remedy[url] = { attempts: 0, actions: [], needsHuman: false, healedAt: new Date().toISOString() };
        if (!args.dryRun) console.log(`  [sembuh] ${url} — riwayat remedi direset`);
      }
      continue;
    }

    if (label === 'blocked') {
      buckets.blocked++;
      state.remedy[url] = {
        ...prev,
        needsHuman: true,
        note: 'robots/noindex — perbaiki robots.txt atau meta tag (tidak bisa dicoba otomatis)',
      };
      needHuman.push({ url, label, why: 'blocked (robots/noindex)' });
      continue;
    }

    if (!ACTIONABLE.has(label)) {
      buckets.unknown++;
      continue;
    }

    // Sudah exhausted → eskalasi, jangan diulang diam-diam.
    if (prev.needsHuman) {
      buckets.actionable++;
      needHuman.push({ url, label, why: `sudah ${prev.attempts}× siklus tanpa hasil` });
      continue;
    }

    // Backoff: jangan ping ulang sebelum nextCheckAt.
    if (!args.force && prev.nextCheckAt && Date.parse(prev.nextCheckAt) > now()) {
      buckets.waiting++;
      continue;
    }

    buckets.actionable++;
    const actions = ['indexnow'];
    // Bing re-submit hanya berguna kalau cooldown sudah lewat (30 hari).
    const lastBing = state.bing?.submitted?.[url]?.at;
    const bingCooldownOk = !lastBing || now() - Date.parse(lastBing) > DEFAULTS.bingCooldownDays * DAY;
    if (label === 'not_indexed' && bingCooldownOk) actions.push('bing');
    if (label === 'not_discovered') actions.push('sitemap');
    plan.push({ url, label, actions, attempts: prev.attempts, coverage: inspections[url]?.coverageState || '' });
  }

  console.log(`  ringkasan: sehat ${buckets.healthy} · perlu tindakan ${buckets.actionable} · menunggu backoff ${buckets.waiting} · blocked ${buckets.blocked} · unknown ${buckets.unknown}`);

  if (!plan.length) {
    console.log('\n  tidak ada URL yang butuh tindakan siklus ini' + (buckets.waiting ? ` (${buckets.waiting} masih dalam backoff — pakai --force untuk recheck paksa)` : ''));
  }
  for (const item of plan) {
    console.log(`\n  · ${item.url}\n    label ${item.label} (${item.coverage}) · siklus ke-${item.attempts + 1}/${maxAttempts} · aksi: ${item.actions.join(' + ')}`);
  }
  for (const h of needHuman) console.log(`\n  ⚠ perlu manusia: ${h.url} — ${h.why}`);

  if (args.dryRun) {
    console.log('\n(--dry-run: tidak ada ping, tidak ada penulisan state)');
    return 0;
  }

  // --- eksekusi ------------------------------------------------------------
  const results = [];
  const pingUrls = plan.filter((p) => p.actions.includes('indexnow')).map((p) => p.url);
  if (pingUrls.length) {
    console.log(`\n── IndexNow: ping ${pingUrls.length} URL`);
    const r = await run('indexnow.mjs', pingUrls);
    results.push({ step: 'indexnow', urls: pingUrls.length, code: r.code });
  }

  const bingUrls = plan.filter((p) => p.actions.includes('bing')).map((p) => p.url);
  let bingDone = [];
  if (bingUrls.length) {
    const capped = bingUrls.slice(0, args.maxPings);
    const dropped = bingUrls.length - capped.length;
    if (dropped) console.log(`  ⚠ ${dropped} URL tidak di-re-submit (cap --max-pings ${args.maxPings}; kuota Bing 100/hari)`);
    console.log(`── Bing: re-submit ${capped.length} URL${args.force ? ' (--force)' : ''}`);
    const r = await run('bing-submit.mjs', [`--urls=${capped.join(',')}`, '--force']);
    bingDone = r.code === 0 ? capped : [];
    results.push({ step: 'bing', urls: capped.length, ok: r.code === 0, code: r.code });
  }

  let sitemapDone = false;
  if (plan.some((p) => p.actions.includes('sitemap'))) {
    // Submit ulang sitemap hanya 1× per 24 jam, dan hanya kalau kredensial ada.
    const last = Date.parse(state.gsc?.sitemapSubmittedAt || 0) || 0;
    const due = now() - last > DEFAULTS.sitemapResubmitHours * 3600000;
    if (!due) {
      console.log(`── GSC sitemap: dilewati (sudah disubmit <${DEFAULTS.sitemapResubmitHours} jam lalu)`);
    } else {
      console.log('── GSC sitemap: submit ulang (untuk URL yang belum ditemukan Google)');
      try {
        sitemapDone = await submitSitemap();
        state.gsc = state.gsc || {};
        state.gsc.sitemapSubmittedAt = new Date().toISOString();
        console.log(`   ${sitemapDone ? 'OK 204' : 'GAGAL'} · site ${SITE_URL}`);
      } catch (e) {
        console.log(`   GAGAL: ${e.message.slice(0, 120)}`);
      }
      results.push({ step: 'sitemap', ok: sitemapDone });
    }
  }

  // --- catat hasil ---------------------------------------------------------
  for (const item of plan) {
    const prev = state.remedy[item.url] || { attempts: 0 };
    const attempts = (prev.attempts || 0) + 1;
    const didSomething = item.actions.includes('indexnow') || (item.actions.includes('bing') && bingDone.includes(item.url)) || sitemapDone;
    const exhausted = attempts >= maxAttempts;
    state.remedy[item.url] = {
      attempts,
      lastAction: new Date().toISOString(),
      actions: item.actions,
      nextCheckAt: new Date(now() + recheckDays * DAY).toISOString(),
      needsHuman: exhausted,
      note: exhausted ? `sudah ${attempts}× siklus (${item.label}) tanpa perubahan — eskalasi ke manusia` : item.label,
      progressed: didSomething,
    };
    if (exhausted) needHuman.push({ url: item.url, label: item.label, why: `sudah ${attempts}× siklus` });
  }

  // alert untuk notify.mjs
  const blockedUrls = needHuman.filter((h) => h.why.startsWith('blocked'));
  const exhaustedUrls = needHuman.filter((h) => !h.why.startsWith('blocked'));
  state.remedyAlert = needHuman.length
    ? {
        at: new Date().toISOString(),
        level: blockedUrls.length ? 'critical' : 'warn',
        code: blockedUrls.length ? 'remedy_blocked' : 'remedy_exhausted',
        msg: blockedUrls.length
          ? `${blockedUrls.length} URL ter-block (robots/noindex) — perlu perbaikan manual`
          : `${exhaustedUrls.length} URL tidak terindeks setelah ${maxAttempts}× siklus remedi — perlu review`,
        urls: needHuman.map((h) => h.url),
      }
    : null;
  state.remedyLastRun = {
    at: new Date().toISOString(),
    buckets,
    planned: plan.length,
    pinged: pingUrls.length,
    bingResubmitted: bingDone.length,
    sitemapResubmitted: sitemapDone,
    needsHuman: needHuman.length,
  };

  saveState(state);

  console.log(`\nringkasan: ping ${pingUrls.length} · bing re-submit ${bingDone.length} · sitemap ${sitemapDone ? 'ya' : 'tidak'} · perlu manusia ${needHuman.length}`);
  console.log('(state.json → remedy[], remedyAlert, remedyLastRun)');
  for (const r of results) console.log(`  · ${r.step}: ${JSON.stringify(r)}`);

  if (args.json) console.log(JSON.stringify({ plan, needHuman, results }, null, 2));
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
