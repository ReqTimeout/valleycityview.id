#!/usr/bin/env node
/**
 * seo/indexer.mjs — orchestrator index pipeline (plan v2 §3.2 / §14.2 item 1.6).
 *
 * Menjalankan 4 tahap berurutan sebagai SUBPROCESS terpisah (bukan import):
 *   1. indexnow   → seo/indexnow.mjs     (real-time, unlimited, tidak wajib)
 *   2. bing       → seo/bing-submit.mjs  (100 URL/hari, wajib)
 *   3. gsc        → seo/gsc-inspect.mjs  (URL Inspection, wajib)
 *   4. remedy     → seo/remedy.mjs       (auto-remedi, opsional)
 *   5. ramp       → seo/ramp-gate.mjs    (hanya Senin / --ramp)
 *
 * Kenapa subprocess, bukan import:
 *   - Semua script `seo/*.mjs` punya side-effect di top-level. `import()` =-run
 *     pipeline (insiden 1 Okt 2026: 3 draft ter-flip published). Subprocess
 *     membuat ini mustahil terjadi.
 *   - Semua tahap menulis `state.json`; subprocess berurutan = tidak ada write race.
 *
 * Urutan penting: ramp harus setelah gsc (membaca `state.gsc.inspections` hasil
 * inspeksi hari ini) dan setelah remedy (remedi menulis `state.remedy`).
 *
 * Usage:
 *   node seo/indexer.mjs                 # pipeline penuh
 *   node seo/indexer.mjs --dry-run       # tampilkan rencana, tidak jalan apa pun
 *   node seo/indexer.mjs --days 7        # window publish (default 1, default manterunner)
 *   node seo/indexer.mjs --ramp          # paksa ramp-gate jalan (default: hanya Senin)
 *   node seo/indexer.mjs --only=bing,gsc # jalankan tahap tertentu saja
 *   node seo/indexer.mjs --skip=ramp     # lonwati tahap
 *   node seo/indexer.mjs --json          # ringkasan JSON (untuk notify/email)
 *   node seo/indexer.mjs --no-preflight  # skip cek kredensial sebelum pipeline
 *
 * Env: GSC_SERVICE_ACCOUNT_JSON_B64 | GSC_SA_FILE · BING_API_KEY · SOCIO_INDEXNOW_KEY
 * Exit: 0 = semua tahap wajib sukses (tahap opsional gagal tetap 0, tapi dicetak WARN),
 *       1 = ada tahap wajib gagal (auth/key hilang, API down) → runner tidak lanjut publish.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { STATE_PATH } from './paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAMP_DAY = Number(process.env.SEO_RAMP_DAY ?? 1); // 1 = Senin (getUTCDay)

const STAGES = [
  {
    name: 'indexnow',
    script: 'indexnow.mjs',
    critical: false,
    note: 'real-time Bing/Yandex/Seznam — unlimited, best-effort',
    args: (ctx) => ctx.urls,
  },
  {
    name: 'bing',
    script: 'bing-submit.mjs',
    critical: true,
    note: 'Bing URL Submission API — 100 URL/hari',
    args: (ctx) => (ctx.dryRun ? ['--dry-run'] : []).concat(['--days', String(ctx.days)]),
  },
  {
    name: 'gsc',
    script: 'gsc-inspect.mjs',
    critical: true,
    note: 'URL Inspection — 2.000/hari, 600/menit',
    args: (ctx) => (ctx.dryRun ? ['--dry-run'] : []).concat(['--days', String(ctx.days)]),
  },
  {
    name: 'remedy',
    script: 'remedy.mjs',
    critical: false,
    note: 'remedi untuk not_indexed / not_discovered (3 siklus → needs_human)',
    args: (ctx) => (ctx.dryRun ? ['--dry-run'] : []),
  },
  {
    name: 'ramp',
    script: 'ramp-gate.mjs',
    critical: false,
    note: 'set daily_count dari index_rate (hanya Senin / --ramp)',
    args: (ctx) => (ctx.dryRun ? ['--dry-run'] : []),
  },
];

function parseArgs(argv) {
  const args = { days: 1, dryRun: false, ramp: false, json: false, preflight: true, only: null, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--ramp') args.ramp = true;
    else if (a === '--json') args.json = true;
    else if (a === '--no-preflight') args.preflight = false;
    else if (a === '--preflight') args.preflight = true;
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--skip=')) args.skip = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    // Terima dua bentuk supaya konsisten dengan gsc-inspect/bing-submit:
    //   --days=7  dan  --days 7
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a.startsWith('--days=')) args.days = Number(a.slice(7));
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip') args.skip = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  if (!Number.isFinite(args.days) || args.days < 0) throw new Error(`--days tidak valid: ${args.days}`);
  return args;
}

/** URL published yang layak diping (yang IndexNow belum pernah dikirim). */
function pickPingUrls(state, days) {
  const already = state.indexnow?.submitted || [];
  const cutoff = Date.now() - days * 86400000;
  return (state.published || [])
    .filter((p) => {
      const t = Date.parse(`${String(p.firstSeen).slice(0, 10)}T00:00:00Z`);
      return !Number.isNaN(t) && t >= cutoff;
    })
    .map((p) => p.url)
    .filter((u) => u && !already.includes(u));
}

function runStage(stage, argv) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(HERE, stage.script), ...argv], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
    child.on('error', (e) => resolve({ code: 1, ms: Date.now() - started, error: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, ms: Date.now() - started }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        'Usage: node seo/indexer.mjs [--dry-run] [--days=N] [--ramp] [--only=a,b] [--skip=c] [--json]',
        '  --dry-run   tampilkan rencana, tidak menjalankan apa pun',
        '  --days=N    window publish (default 1)',
        '  --ramp      paksa ramp-gate (default hanya Senin)',
        '  --only=a,b  hanya tahap tersebut',
        '  --no-preflight  skip cek kredensial (default: preflight ON saat live)',
        '  --skip=c    lewati tahap',
      ].join('\n')
    );
    return 0;
  }

  if (!existsSync(STATE_PATH)) {
    console.error(`FATAL: state.json tidak ada (${STATE_PATH}) — jalankan: node seo/bootstrap-state.mjs`);
    return 1;
  }
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  const ctx = { ...args, urls: pickPingUrls(state, args.days) };

  const isMonday = new Date().getUTCDay() === RAMP_DAY;
  let plan = STAGES.filter((s) => {
    if (args.only && !args.only.includes(s.name)) return false;
    if (args.skip.includes(s.name)) return false;
    return true;
  });
  if (!args.ramp && !isMonday) plan = plan.filter((s) => s.name !== 'ramp');

  console.log(`indexer — ${args.dryRun ? 'DRY-RUN' : 'LIVE'} · window ${args.days} hari · ${new Date().toISOString()}`);
  console.log(`  env      : GSC=${hasEnv('GSC_SERVICE_ACCOUNT_JSON_B64') || hasEnv('GSC_SA_FILE') ? 'ada' : 'KOSONG'} · BING=${hasEnv('BING_API_KEY') ? 'ada' : 'KOSONG'} · INDEXNOW=${hasEnv('SOCIO_INDEXNOW_KEY') || existsSync(join(HERE, '../site/public/indexnow.txt')) ? 'ada' : 'KOSONG'}`);
  console.log(`  ping URLs: ${ctx.urls.length}${args.ramp ? '' : isMonday ? ' · ramp: Senin (otomatis)' : ` · ramp: dilewati (bukan Senin, pakai --ramp untuk paksa)`}`);
  console.log(`  tahap    : ${plan.map((s) => s.name).join(' → ') || '(tidak ada)'}\n`);

  // Preflight (live saja): cek kredensial SEBELUM tahap apa pun. Tanpa ini, kalau
  // tidak ada URL yang perlu diproses, tahap gsc/bing keluar "OK" padahal
  // kredensialnya rusak — fail-nya baru ketahuan saat publish sudah jalan.
  if (!args.dryRun && args.preflight) {
    console.log('── preflight · seo/scripts/gsc-doctor.mjs --auth-only');
    const pre = await runStage({ name: 'preflight', script: 'scripts/gsc-doctor.mjs', critical: true }, ['--auth-only']);
    if (pre.code !== 0) {
      console.log(`   → FAIL (exit ${pre.code})\n`);
      console.log('⛔ preflight gagal — tahap tidak dijalankan sama sekali.');
      console.log('   GSC: cek GSC_SITE_URL (harus sc-domain:valleycity.id) + SA Owner → docs/GOOGLE_CLOUD_SETUP.md §13.1');
      process.exitCode = 1;
      return 1;
    }
    console.log('   → OK\n');
  }

  const results = [];
  for (const stage of plan) {
    const argv = stage.args(ctx);
    if (stage.name === 'indexnow' && !argv.length) {
      console.log(`── ${stage.name} · dilewati: tidak ada URL baru (${stage.note})\n`);
      results.push({ name: stage.name, status: 'skipped', reason: 'no new urls', ms: 0 });
      continue;
    }
    console.log(`── ${stage.name} · ${stage.note}`);
    if (args.dryRun) {
      console.log(`   (dry-run) akan jalan: node seo/${stage.script} ${argv.map((a) => (a.startsWith('http') ? a.replace(/^https:\/\/valleycity\.id/, '') : a)).join(' ')}\n`);
      results.push({ name: stage.name, status: 'dry-run', ms: 0 });
      continue;
    }
    const r = await runStage(stage, argv);
    const ok = r.code === 0;
    const tag = ok ? 'OK' : stage.critical ? 'FAIL' : 'WARN';
    console.log(`   → ${tag} (exit ${r.code}, ${(r.ms / 1000).toFixed(1)}s)\n`);
    results.push({ name: stage.name, status: ok ? 'ok' : stage.critical ? 'fail' : 'warn', code: r.code, ms: r.ms });
  }

  const criticalFailed = results.filter((r) => r.status === 'fail');
  const warned = results.filter((r) => r.status === 'warn');
  const ran = results.filter((r) => r.status === 'ok').map((r) => r.name);
  const summary = {
    at: new Date().toISOString(),
    dryRun: args.dryRun,
    windowDays: args.days,
    rampTriggered: plan.some((s) => s.name === 'ramp'),
    stages: results,
    criticalFailed: criticalFailed.length,
    warned: warned.length,
  };

  if (!args.dryRun) {
    const st = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    st.indexer = { lastRun: summary };
    const tmp = `${STATE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n');
    renameSync(tmp, STATE_PATH);
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`ringkasan: ok=${ran.join(',') || '-'} · warn=${warned.map((w) => w.name).join(',') || '-'} · fail=${criticalFailed.map((f) => f.name).join(',') || '-'}`);
    if (criticalFailed.length) {
      console.log('\n⛔ tahap wajib gagal → JANGAN lanjut publish hari ini. Cek: node seo/scripts/gsc-doctor.mjs');
      console.log('   docs/GOOGLE_CLOUD_SETUP.md §13 (403 = property/scope, quota = §13.5, Bing = §13.6)');
    } else if (warned.length) {
      console.log('\n⚠ tahap opsional gagal (tidak halt):');
      for (const w of warned) console.log(`   · ${w.name} — retry di run berikutnya, kuota belum tentu habis`);
    }
    if (!args.dryRun) console.log('\n(state.json → indexer.lastRun tercatat)');
  }

  return criticalFailed.length ? 1 : 0;
}

function hasEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  });
