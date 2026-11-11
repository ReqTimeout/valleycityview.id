#!/usr/bin/env node
/**
 * runner/daily.mjs — pipeline harian SEO engine socio.id (06:00 WIB).
 *
 * Tahap:
 *   0. lock anti double-run (runner/lib/lock.mjs)
 *   1. seo/indexer.mjs → indexnow → bing-submit → gsc-inspect → remedy → ramp-gate
 *   2. seo/generate.mjs  → bikin draft baru (kuota = SEO_GENERATE_COUNT)
 *   3. seo/publish.mjs   → flip draft → build landing → wrangler deploy → IndexNow
 *                          (jumlah = config.daily_count, ditulis ramp-gate dari index_rate GSC)
 *   4. ringkasan + email (runner/lib/notify.mjs)
 *
 * PERBAIKAN 4 Okt 2026 — publish sebelumnya no-op. Penyebabnya BUKAN lupa: image
 * runner hanya berisi `seo/` + `runner/`, jadi tidak punya source `landing/` dan
 * tidak bisa build Astro sama sekali. Dockerfile sekarang menyalin `landing/` +
 * `packages/ui` dan memasang pnpm, jadi tahap 2–3 bisa jalan.
 *
 * Fail-closed: kalau tahap 1 (indexer) gagal, tahap 2-3 TIDAK dijalankan. Alasan -
 * indexer yang gagal berarti GSC tidak bisa mengukur, jadi mempublish artikel baru
 * hanya menghasilkan halaman yang tidak terukur. Itu memperbesar discovery_gap.
 *
 * Env:
 *   SEO_STATE_PATH · SEO_CONFIG_PATH · GSC_* · BING_API_KEY · GROQ_API_KEY
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

/** Ringkasan angka untuk email + keputusan ramp. */
function buildSummary(state) {
  const published = state.published || [];
  const insp = state.gsc?.inspections || {};
  const last = state.gsc?.lastRun || {};
  const labels = published.reduce((acc, p) => {
    const l = p.indexed || 'unknown';
    acc[l] = (acc[l] || 0) + 1;
    return acc;
  }, {});
  const discovered = (labels.indexed || 0) + (labels.not_indexed || 0) + (labels.blocked || 0);
  const rate = discovered ? (labels.indexed || 0) / discovered : null;
  return {
    total: published.length,
    labels,
    indexRate: rate,
    discoveryGap: (labels.not_discovered || 0) + (labels.unknown || 0),
    lastInspect: last.at || null,
    bing: state.bing?.lastRun || null,
    alerts: [state.rampGate?.alert, state.remedyAlert].filter(Boolean),
    indexer: state.indexer?.lastRun || null,
    dailyCount: null,
  };
}

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
  if (!existsSync(STATE)) {
    console.error(`FATAL: state.json tidak ada di ${STATE}`);
    return 1;
  }

  const lock = await acquireLock('daily');
  if (!lock.acquired) {
    log(`SKIP — masih ada run lain (pid ${lock.holder?.pid} di ${lock.holder?.host}, mulai ${lock.holder?.at})`);
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
    } else {
      log('jalan: seo/indexer.mjs');
      const r = await run('seo/indexer.mjs', []);
      indexerCode = r.code;
      log(`indexer selesai exit=${r.code}`);
    }

    const cfg = readConfig();
    const dailyCount = Number(cfg.daily_count ?? 1);
    log(`config: daily_count=${dailyCount} (ditulis ramp-gate dari index_rate GSC)`);

    // ── tahap 2: generate draft ────────────────────────────────────────────
    // Dipasang supaya SELALU ada buffer draft. Kalau publish harian 3 tapi
    // generate 0, mengering pada hari ke-2. Default 2× daily_count.
    if (indexerCode !== 0) {
      log('indexer gagal → generate TIDAK dijalankan (fail-closed)');
    } else if (process.env.SEO_SKIP_GENERATE === '1') {
      log('SEO_SKIP_GENERATE=1 — tahap generate dilewati');
    } else if (!process.env.GROQ_API_KEY) {
      log('GROQ_API_KEY tidak ada → tahap generate dilewati (tidak ada LLM)');
    } else {
      const n = Number(process.env.SEO_GENERATE_COUNT ?? Math.max(1, dailyCount * 2));
      log(`jalan: seo/generate.mjs --count=${n}`);
      const r = await run('seo/generate.mjs', [`--count=${n}`]);
      generateCode = r.code;
      log(`generate selesai exit=${r.code}`);
    }

    // ── tahap 3: publish draft sesuai kuota GSC ────────────────────────────
    if (indexerCode !== 0) {
      log('indexer gagal → publish TIDAK dijalankan (fail-closed)');
    } else if (cfg.halt === true) {
      log('config.halt=true → publish TIDAK dijalankan (butuh reset manual)');
    } else if (process.env.SEO_SKIP_PUBLISH === '1') {
      log('SEO_SKIP_PUBLISH=1 — tahap publish dilewati');
    } else if (!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)) {
      log('CLOUDFLARE_API_TOKEN / ACCOUNT_ID belum di-set → publish dilewati (lihat accountcf.md)');
    } else if (dailyCount <= 0) {
      log('daily_count=0 → tidak ada yang dipublish hari ini');
    } else {
      log(`jalan: seo/publish.mjs --count=${dailyCount}`);
      const r = await run('seo/publish.mjs', [`--count=${dailyCount}`]);
      publishCode = r.code;
      log(`publish selesai exit=${r.code}`);
    }

    const state = readState();
    const s = buildSummary(state);
    s.dailyCount = dailyCount;
    published = state.published?.length ?? 0;
    const q = countQueue();
    generated = q.draft;
    pending = q.pending;

    const rateText = s.indexRate === null ? 'n/a' : `${(s.indexRate * 100).toFixed(1)}%`;
    const lines = [
      `antrean: ${q.pending} pending · ${q.draft} draft siap · ${q.published} published`,
      `URL published: ${s.total}`,
      `label: indexed ${s.labels.indexed || 0} · not_indexed ${s.labels.not_indexed || 0} · not_discovered ${s.labels.not_discovered || 0} · blocked ${s.labels.blocked || 0} · unknown ${s.labels.unknown || 0}`,
      `index_rate (indexed/discovered): ${rateText}`,
      `kuota publish hari ini: ${dailyCount} (generate exit=${generateCode ?? 'skip'}, publish exit=${publishCode ?? 'skip'})`,
      `Bing: ${s.bing ? `submit ${s.bing.submitted} URL, kuota ${s.bing.quotaAfter}/${s.bing.quotaBefore}` : 'belum ada run'}`,
      `inspeksi GSC terakhir: ${s.lastInspect || 'belum'}`,
      `indexer: ${s.indexer ? s.indexer.stages.map((x) => `${x.name}=${x.status}`).join(' ') : 'belum ada run'}`,
    ];

    await sendReport({
      subject: `[socio-seo] harian ${new Date().toISOString().slice(0, 10)} — index_rate ${rateText}${indexerCode === 0 ? '' : ' (INDEXER GAGAL)'}`,
      heading: 'SEO engine socio.id — laporan harian',
      lines,
      alerts: s.alerts,
    });

    return indexerCode;
  } finally {
    lock.release();
    log('lock dilepas');
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
