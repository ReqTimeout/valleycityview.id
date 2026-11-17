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
 *   SEO_STATE_PATH · SEO_CONFIG_PATH · SEO_RUNS_PATH · GSC_* · BING_API_KEY · QWEN_API_KEY · GROQ_API_KEY
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
import { sendReport, notifyCc } from './lib/notify.mjs';
import { openRun } from './lib/runlog.mjs';
import { publishScript } from './lib/config.mjs';
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
// Hari WIB (UTC+7) untuk "dibuat/terbit hari ini" — daily jalan 23:00 UTC,
// angka UTC akan meleset ke hari sebelumnya (pelajaran flipDraft 14 Nov).
const wibDay = (d) => new Date(new Date(d).getTime() + 7 * 3600000).toISOString().slice(0, 10);

function countQueue() {
  const p = process.env.SEO_QUEUE_PATH || join(ROOT, 'seo/queue.json');
  const c = { pending: 0, draft: 0, published: 0, createdToday: 0, pubToday: 0 };
  const today = wibDay(new Date());
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items || [];
    for (const it of items) {
      const s = it?.status;
      if (s in c) c[s]++;
      if (it?.generatedAt && wibDay(it.generatedAt) === today) c.createdToday++;
      if (it?.publishedAt && wibDay(it.publishedAt) === today) c.pubToday++;
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

    // ── pengukuran pendukung dashboard (SELALU jalan, non-fatal) ───────────
    // gsc-history: deret klik/tayangan/posisi harian + halaman teratas (chart).
    // site-checks: robots/sitemap/llms/indexnow/beranda diambil langsung dari
    // situs hidup. Keduanya tidak boleh menggagalkan daily — kegagalan mereka
    // cukup tampil apa adanya di dashboard.
    log('jalan: seo/gsc-history.mjs');
    const rh = await run('seo/gsc-history.mjs', []);
    log(`gsc-history exit=${rh.code}`);
    rl.step('history', rh.code === 0 ? 'ok' : 'warn', `exit ${rh.code}`);
    log('jalan: seo/site-checks.mjs');
    const rc = await run('seo/site-checks.mjs', []);
    log(`site-checks exit=${rc.code}`);
    rl.step('checks', rc.code === 0 ? 'ok' : 'warn', `exit ${rc.code}`);

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
    } else if (!(process.env.QWEN_API_KEY || process.env.GROQ_API_KEY)) {
      log('QWEN_API_KEY / GROQ_API_KEY tidak ada → tahap generate dilewati (tidak ada LLM)');
      rl.step('generate', 'skip', 'QWEN_API_KEY / GROQ_API_KEY belum di-set');
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
    // PROD (SEO_DAILY_PUBLISH=0): publish DIPEGANG tick (jendela 08–16 WIB,
    // 1/jam) — sama seperti sbdental. Daily hanya menyiapkan: indexer +
    // generate + laporan. Artikel selalu tayang di jam kerja, bukan 06:00,
    // dan kuota harian dijaga satu mekanisme saja (tick).
    if (process.env.SEO_DAILY_PUBLISH === '0') {
      log('SEO_DAILY_PUBLISH=0 → publish dipegang tick (jendela harian)');
      rl.step('publish', 'skip', 'tick yang publish dalam jendela 08–16 WIB');
    } else if (indexerCode !== 0) {
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
      log(`jalan: ${publishScript} --count=${dailyCount}`);
      const r = await run(publishScript, [`--count=${dailyCount}`]);
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
    const tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const judul = `Laporan Harian SEO — ${tanggal}`;

    const CHECK_NAMES = {
      robots: 'Akses mesin pencari', sitemap: 'Peta situs', llms: 'Info untuk AI (llms.txt)',
      indexnow: 'Notifikasi mesin pencari', beranda: 'Halaman utama',
    };
    const checks = state.checks || {};
    const checkKeys = Object.keys(checks).filter((k) => k !== '_meta');

    // KPI besar — dibaca sekilas tanpa menelusuri teks.
    const stats = [
      { label: 'Dibuat hari ini', value: q.createdToday, sub: 'artikel baru' },
      { label: 'Terbit hari ini', value: q.pubToday, sub: 'jadwal 08–16 WIB' },
      { label: 'Total tayang', value: s.total, sub: 'artikel di situs' },
      { label: 'Draft siap', value: q.draft, sub: `${q.pending} keyword menunggu` },
    ];

    // ── YANG BERJALAN BAIK (hijau) ──────────────────────────────────────────
    const good = [];
    for (const k of checkKeys) {
      const it = checks[k] || {};
      if (it.status === 'ok') good.push({ label: CHECK_NAMES[k] || k, status: 'ok', detail: it.detail || 'lolos pemeriksaan' });
    }
    const inowN = (state.indexnow?.submitted || []).length;
    if (inowN) good.push({ label: 'IndexNow (Bing/Yandex/etc)', status: 'ok', detail: `${inowN} URL sudah diberitahu` });
    const bingN = state.bing?.submitted ? Object.keys(state.bing.submitted).length : 0;
    if (bingN) good.push({ label: 'Bing Webmaster', status: 'ok', detail: `${bingN} URL dikirim ke Bing` });
    if (s.indexer) for (const x of s.indexer.stages) if (x.status === 'ok') good.push({ label: `Indexer: ${x.name}`, status: 'ok', detail: 'selesai' });
    if (!good.length) good.push({ label: 'Pemeriksaan situs', status: 'info', detail: 'belum ada hasil hari ini' });

    // ── PERLU PERHATIAN (kuning/merah) ──────────────────────────────────────
    const bad = [];
    for (const k of checkKeys) {
      const it = checks[k] || {};
      if (it.status === 'warn' || it.status === 'fail') bad.push({ label: CHECK_NAMES[k] || k, status: it.status, detail: it.detail || '' });
    }
    for (const a of s.alerts || []) bad.push({ label: a.code || 'Peringatan', status: a.level === 'critical' ? 'fail' : 'warn', detail: a.msg || '' });
    if (s.indexRate != null && s.indexRate < 0.7) {
      bad.push({ label: 'Cakupan indeks Google', status: 'warn', detail: `${rateStr} artikel terindeks — wajar untuk situs baru; kuota publish dijaga ${dailyCount}/hari sampai naik` });
    }
    if (q.pending === 0 && generateCode != null && generateCode !== 0) {
      bad.push({ label: 'Generate keyword', status: 'info', detail: 'berhenti wajar — semua keyword sudah dibuat menjadi artikel' });
    }
    if (!bad.length) bad.push({ label: 'Tidak ada peringatan aktif', status: 'ok', detail: 'semua pemeriksaan lolos' });

    // ── PERFORMA GOOGLE (jujur: 0 = belum ada data, bukan karangan) ─────────
    const gsc = state.gsc || {};
    const gscSection = (gsc.agg && (gsc.agg.impressions || gsc.agg.clicks))
      ? { title: 'Performa di Google (30 hari)', items: [
          { label: 'Klik', status: 'info', detail: String(gsc.agg.clicks ?? 0) },
          { label: 'Tayang (impressions)', status: 'info', detail: String(gsc.agg.impressions ?? 0) },
          { label: 'Rasio klik', status: 'info', detail: gsc.agg.ctr != null ? (gsc.agg.ctr * 100).toFixed(1) + '%' : '—' },
          { label: 'Posisi rata-rata', status: 'info', detail: gsc.agg.position != null ? String(gsc.agg.position) : '—' },
        ] }
      : { title: 'Performa di Google', body: gsc.historyNote || 'Data Google sedang dikumpulkan — biasanya muncul 1–2 minggu setelah artikel tayang. Angka 0 bukan berarti gagal; situs masih baru.', note: 'Tidak ada angka yang dikarang.' };

    // ── RINCIAN (info netral, bahasa manusia) ───────────────────────────────
    const L = s.labels || {};
    const rincian = { title: 'Rincian teknis', items: [
      { label: 'Antrean produksi', status: 'info', detail: `${q.pending} menunggu · ${q.draft} draft siap · ${q.published} tayang` },
      { label: 'Kuota publish hari ini', status: 'info', detail: `${dailyCount} artikel (ditentukan otomatis dari cakupan indeks)` },
      { label: 'Status indeks Google', status: 'info', detail: `Terindeks ${L.indexed || 0} · Belum terindeks ${L.not_indexed || 0} · Belum ditemukan ${L.not_discovered || 0}` },
      { label: 'Inspeksi GSC terakhir', status: 'info', detail: s.lastInspect || 'belum pernah' },
    ] };

    const sections = [
      { title: 'Yang berjalan baik', items: good },
      { title: 'Perlu perhatian', items: bad },
      gscSection,
      rincian,
    ];

    // Laporan harian: internal (NOTIFY_EMAIL_TO) + klien (NOTIFY_EMAIL_CC).
    await sendReport({
      kind: 'harian',
      subject: `[${NOTIFY_PREFIX}] ${judul}${indexerCode === 0 ? '' : ' — INDEXER GAGAL'}`,
      title: judul,
      date: tanggal,
      cc: notifyCc(),
      stats,
      sections,
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
