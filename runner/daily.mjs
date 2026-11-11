#!/usr/bin/env node
/**
 * runner/daily.mjs — pipeline harian SEO engine valleycity.id (06:00 WIB).
 *
 * Tahap:
 *   0. lock anti double-run (runner/lib/lock.mjs)
 *   1. seo/indexer.mjs → indexnow → bing-submit → gsc-inspect → remedy → ramp-gate
 *   2. seo/generate.mjs  → bikin draft baru (kuota = SEO_GENERATE_COUNT)
 *   3. seo/publish.mjs   → flip draft → build landing → wrangler deploy → IndexNow
 *                          (jumlah = config.daily_count, ditulis ramp-gate dari index_rate GSC)
 *   4. ringkasan + email (runner/lib/notify.mjs)
 *
 * Setiap tahap dicatat ke seo/runs.json (runner/lib/runlog.mjs) termasuk yang
 * DILEWATI, dengan alasannya. Dashboard halaman "Runs" membaca berkas itu; tanpa
 * catatan skip, "tidak ada apa pun hari ini" dan "pipeline tidak pernah jalan"
 * tampak identik.
 *
 * Fail-closed: kalau tahap 1 (indexer) gagal, tahap 2-3 TIDAK dijalankan. Alasan -
 * indexer yang gagal berarti GSC tidak bisa mengukur, jadi mempublish artikel baru
 * hanya menghasilkan halaman yang tidak terukur. Itu memperbesar discovery_gap.
 *
 * Env:
 *   SEO_STATE_PATH · SEO_CONFIG_PATH · SEO_RUNS_PATH · GSC_* · BING_API_KEY · GROQ_API_KEY
 *   CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID
 *   RESEND_API_KEY · NOTIFY_EMAIL_TO · NOTIFY_EMAIL_FROM
 *   SEO_SKIP_INDEXER=1   · SEO_SKIP_GENERATE=1 · SEO_SKIP_PUBLISH=1
 *   SEO_GENERATE_COUNT=N (default: 2 × daily_count, minimal 1)
 * Exit: 0 = aman, 1 = gagal (tahap wajib indexer).
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { acquireLock } from './lib/lock.mjs';
import { sendReport } from './lib/notify.mjs';
import { openRun } from './lib/runlog.mjs';
// Prefix subject datang dari seo/site.mjs: kalau defaultnya berubah di satu
// tempat, kita tidak ingin email masih memakai nama proyek lama.
import { NOTIFY_PREFIX } from '../seo/site.mjs';
// Rumus angka laporan hidup di satu tempat (email, mingguan, dashboard).
import { buildSummary, rateText as fmtRate } from '../seo/lib/summary.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STATE = process.env.SEO_STATE_PATH || join(ROOT, 'seo/state.json');

const log = (m) => console.log(`[daily] ${m}`);

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, script), ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
    child.on('error', (e) => resolve({ code: 1, error: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

// buildSummary() dulu hidup di sini. Sekarang di seo/lib/summary.mjs supaya
// email harian, laporan mingguan, dan dashboard valleyvity membaca rumus yang
// sama — angka yang sama tidak boleh dihitung dua cara.

/** Baca seo/config.json (daily_count dll). Default konservatif kalau hilang. */
function readConfig() {
  const p = process.env.SEO_CONFIG_PATH || join(ROOT, 'seo/config.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Hitung jumlah antrean per status.
 * PENTING: antrean TIDAK ada di state.json — ada di seo/queue.json. state.json
 * cuma nyimpen `published` + hasil pengukuran (gsc/bing/rampGate). 4 Okt:
 * versi pertama baca state.queue.items sehingga draft selalu tampil 0.
 */
function countQueue() {
  const p = process.env.SEO_QUEUE_PATH || join(ROOT, 'seo/queue.json');
  const c = { pending: 0, draft: 0, published: 0 };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items || [];
    for (const it of items) {
      const s = it?.status;
      if (s in c) c[s]++;
    }
  } catch {
    /* queue tidak terbaca — laporan akan tampil 0, tidak boleh menggagalkan run */
  }
  return c;
}

async function main() {
  log(`start ${new Date().toISOString()}`);
  const rl = openRun('daily');
  if (!existsSync(STATE)) {
    console.error(`FATAL: state.json tidak ada di ${STATE}`);
    rl.step('bootstrap', 'fail', `state.json tidak ada di ${STATE}`);
    rl.finish(1);
    return 1;
  }

  const lock = await acquireLock('daily');
  if (!lock.acquired) {
    const why = `pid ${lock.holder?.pid} di ${lock.holder?.host}, mulai ${lock.holder?.at}`;
    log(`SKIP — masih ada run lain (${why})`);
    rl.setLock('held-by-other', why);
    rl.finish(0);
    return 0;
  }
  log(`lock diambil (pid ${process.pid})`);

  let indexerCode = 0;
  let generateCode = null;
  let publishCode = null;
  let generated = 0;
  let pending = 0;
  let published = 0;

  try {
    if (process.env.SEO_SKIP_INDEXER === '1') {
      log('SEO_SKIP_INDEXER=1 — tahap indexer dilewati (untuk uji notify/lock saja)');
      rl.step('indexer', 'skip', 'SEO_SKIP_INDEXER=1');
    } else {
      log('jalan: seo/indexer.mjs');
      const r = await run('seo/indexer.mjs', []);
      indexerCode = r.code;
      log(`indexer selesai exit=${r.code}`);
      rl.step('indexer', indexerCode === 0 ? 'ok' : 'fail', `exit ${indexerCode}`);
    }

    const cfg = readConfig();
    const dailyCount = Number(cfg.daily_count ?? 1);
    log(`config: daily_count=${dailyCount} (ditulis ramp-gate dari index_rate GSC)`);

    // ── tahap 2: generate draft ────────────────────────────────────────────
    // Dipasang supaya SELALU ada buffer draft. Kalau publish harian 3 tapi
    // generate 0, mengering pada hari ke-2. Default 2× daily_count.
    if (indexerCode !== 0) {
      log('indexer gagal → generate TIDAK dijalankan (fail-closed)');
      rl.step('generate', 'blocked', 'fail-closed: indexer gagal');
    } else if (process.env.SEO_SKIP_GENERATE === '1') {
      log('SEO_SKIP_GENERATE=1 — tahap generate dilewati');
      rl.step('generate', 'skip', 'SEO_SKIP_GENERATE=1');
    } else if (!process.env.GROQ_API_KEY) {
      log('GROQ_API_KEY tidak ada → tahap generate dilewati (tidak ada LLM)');
      rl.step('generate', 'skip', 'GROQ_API_KEY belum di-set');
    } else {
      const n = Number(process.env.SEO_GENERATE_COUNT ?? Math.max(1, dailyCount * 2));
      log(`jalan: seo/generate.mjs --count=${n}`);
      const r = await run('seo/generate.mjs', [`--count=${n}`]);
      generateCode = r.code;
      log(`generate selesai exit=${r.code}`);
      // exit != 0 di tahap ini hampir selalu berarti gerbang tertutup (keyword
      // belum di-approve, audit belum selesai) — bukan crash, dan bedanya harus
      // terbaca di Runs.
      rl.step('generate', generateCode === 0 ? 'ok' : 'blocked', `--count=${n}, exit ${generateCode}`);
    }

    // ── tahap 3: publish draft sesuai kuota GSC ────────────────────────────
    if (indexerCode !== 0) {
      log('indexer gagal → publish TIDAK dijalankan (fail-closed)');
      rl.step('publish', 'blocked', 'fail-closed: indexer gagal');
    } else if (cfg.halt === true) {
      log('config.halt=true → publish TIDAK dijalankan (butuh reset manual)');
      rl.step('publish', 'blocked', `halt=true: ${cfg.halt_reason || 'tanpa alasan'}`);
    } else if (process.env.SEO_SKIP_PUBLISH === '1') {
      log('SEO_SKIP_PUBLISH=1 — tahap publish dilewati');
      rl.step('publish', 'skip', 'SEO_SKIP_PUBLISH=1');
    } else if (!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)) {
      log('CLOUDFLARE_API_TOKEN / ACCOUNT_ID belum di-set → publish dilewati (lihat accountscf.md)');
      rl.step('publish', 'skip', 'CLOUDFLARE_API_TOKEN / ACCOUNT_ID belum di-set');
    } else if (dailyCount <= 0) {
      log('daily_count=0 → tidak ada yang dipublish hari ini');
      rl.step('publish', 'skip', 'daily_count=0');
    } else {
      log(`jalan: seo/publish.mjs --count=${dailyCount}`);
      const r = await run('seo/publish.mjs', [`--count=${dailyCount}`]);
      publishCode = r.code;
      log(`publish selesai exit=${r.code}`);
      rl.step('publish', publishCode === 0 ? 'ok' : 'fail', `--count=${dailyCount}, exit ${publishCode}`);
    }

    const state = readState();
    const s = buildSummary(state);
    s.dailyCount = dailyCount;
    published = state.published?.length ?? 0;
    const q = countQueue();
    generated = q.draft;
    pending = q.pending;

    const rateStr = fmtRate(s.indexRate);
    const lines = [
      `antrean: ${q.pending} pending · ${q.draft} draft siap · ${q.published} published`,
      `URL published: ${s.total}`,
      `label: indexed ${s.labels.indexed || 0} · not_indexed ${s.labels.not_indexed || 0} · not_discovered ${s.labels.not_discovered || 0} · blocked ${s.labels.blocked || 0} · unknown ${s.labels.unknown || 0}`,
      `index_rate (indexed/discovered): ${rateStr}`,
      `kuota publish hari ini: ${dailyCount} (generate exit=${generateCode ?? 'skip'}, publish exit=${publishCode ?? 'skip'})`,
      `Bing: ${s.bing ? `submit ${s.bing.submitted} URL, kuota ${s.bing.quotaAfter}/${s.bing.quotaBefore}` : 'belum ada run'}`,
      `inspeksi GSC terakhir: ${s.lastInspect || 'belum'}`,
      `indexer: ${s.indexer ? s.indexer.stages.map((x) => `${x.name}=${x.status}`).join(' ') : 'belum ada run'}`,
    ];

    await sendReport({
      subject: `[${NOTIFY_PREFIX}] harian ${new Date().toISOString().slice(0, 10)} — index_rate ${rateStr}${indexerCode === 0 ? '' : ' (INDEXER GAGAL)'}`,
      heading: 'SEO engine valleycity.id — laporan harian',
      lines,
      alerts: s.alerts,
    });
    rl.step('report', 'ok', `${NOTIFY_PREFIX} harian`);

    rl.summarize({
      published: s.total,
      measured: s.measured,
      indexRate: s.indexRate,
      dailyCount,
      draft: generated,
      pending,
      indexerExit: indexerCode,
      generateExit: generateCode,
      publishExit: publishCode,
    });

    return indexerCode;
  } finally {
    lock.release();
    log('lock dilepas');
    // Kalau proses mati di tengah jalan, entry ini tetap tinggal dengan exit
    // kosong — dashboard menampilkan itu sebagai "tidak selesai", bukan sukses.
    rl.finish(indexerCode);
  }
}

main()
  .then((code) => {
    log(`exit ${code}`);
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(`FATAL: ${e.message}`);
    process.exitCode = 1;
  });
