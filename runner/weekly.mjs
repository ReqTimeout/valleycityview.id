#!/usr/bin/env node
/**
 * runner/weekly.mjs — pipeline mingguan (Senin 09:00 WIB).
 *
 * Tahap:
 *   1. seo/indexer.mjs            — refresh status index (termasuk ramp-gate hari Senin)
 *   2. mining Search Analytics    — 28 hari → query terbaik → seo/keywords.mined.json
 *   3. freshness                   — segarkan maks FRESH_MAX (2) artikel tua/tipis
 *                                    (seo/freshness.mjs → generate --refresh)
 *   4. ringkasan + email
 *
 * Env: sama seperti runner/daily.mjs, plus SEO_SKIP_INDEXER=1 untuk uji.
 * Exit: 0 = aman, 1 = gagal.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NOTIFY_PREFIX, SITE } from '../seo/site.mjs';
import { acquireLock } from './lib/lock.mjs';
import { sendReport, notifyCc } from './lib/notify.mjs';
import { openRun } from './lib/runlog.mjs';
import { searchAnalytics } from '../seo/lib/gsc.mjs';
import { buildSummary, rateText as fmtRate } from '../seo/lib/summary.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STATE = process.env.SEO_STATE_PATH || join(ROOT, 'seo/state.json');
// mining harus ikut ke volume yang sama dengan state.json — kalau ditulis ke
// /app/seo (di dalam image) hasilnya hilang tiap container di-recreate.
const MINED = process.env.SEO_MINED_PATH || join(dirname(STATE), 'keywords.mined.json');

const log = (m) => console.log(`[weekly] ${m}`);

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
    child.on('error', () => resolve({ code: 1 }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

/** Kumpulkan query yang sudah ada clicked/impression, untuk candidate keyword. */
async function mineQueries(days = 28) {
  const rows = await searchAnalytics({ days, dimensions: ['query'], rowLimit: 100 });
  return rows
    .map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Number((r.ctr ?? 0).toFixed(4)),
      position: Number((r.position ?? 0).toFixed(2)),
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

function saveMined(queries, days) {
  const payload = {
    _meta: { minedAt: new Date().toISOString(), windowDays: days, source: 'GSC searchAnalytics (seo/lib/gsc.mjs)' },
    queries,
  };
  const tmp = `${MINED}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  renameSync(tmp, MINED);
}

async function main() {
  log(`start ${new Date().toISOString()}`);
  const rl = openRun('weekly');
  const lock = await acquireLock('weekly');
  if (!lock.acquired) {
    const why = `pid ${lock.holder?.pid}, mulai ${lock.holder?.at}`;
    log(`SKIP — masih ada run lain (${why})`);
    rl.setLock('held-by-other', why);
    rl.finish(0);
    return 0;
  }
  log('lock diambil');
  let code = 1; // tetap 1 kalau proses mati sebelum sempat selesai

  try {
    if (process.env.SEO_SKIP_INDEXER !== '1') {
      log('jalan: seo/indexer.mjs (ramp-gate jalan otomatis karena hari Senin)');
      const r = await run('seo/indexer.mjs', []);
      rl.step('indexer', r.code === 0 ? 'ok' : 'fail', `exit ${r.code}`);
    } else {
      rl.step('indexer', 'skip', 'SEO_SKIP_INDEXER=1');
    }

    let mined = [];
    let minedError = null;
    try {
      mined = await mineQueries(28);
      saveMined(mined, 28);
      log(`mining: ${mined.length} query disimpan ke ${MINED}`);
      rl.step('mining', mined.length ? 'ok' : 'warn', `${mined.length} query → keywords.mined.json`);
    } catch (e) {
      minedError = e.message;
      log(`mining GAGAL: ${e.message}`);
      rl.step('mining', 'fail', e.message);
    }

    // 3) Freshness — segarkan artikel tua/tipis terpilih (kebijakan & batas di
    // seo/freshness.mjs). Mesh internal-link sendiri sudah dijalankan publish-git
    // tiap terbit, jadi langkah ini murni "segarkan konten lama".
    let freshSlugs = [];
    let freshStats = '';
    try {
      const fr = spawnSync(process.execPath, [join(ROOT, 'seo/freshness.mjs')], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env }, timeout: 210000,
      });
      const fout = `${fr.stdout || ''}${fr.stderr || ''}`;
      const mLine = fout.trim().split('\n').reverse().find((l) => l.startsWith('freshness: '));
      freshStats = (mLine || 'freshness: tanpa keluaran').replace(/^freshness: /, '');
      const mList = fout.match(/daftar disegarkan: (.+)/);
      freshSlugs = mList ? mList[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
      const mNum = freshStats.match(/(\d+)\/(\d+) disegarkan/);
      const okN = mNum ? Number(mNum[1]) : 0;
      const tryN = mNum ? Number(mNum[2]) : 0;
      if (fr.error || fr.status !== 0) {
        log(`freshness GAGAL: ${(fr.error && fr.error.message) || fout.slice(-200)}`);
        rl.step('freshness+mesh', 'fail', freshStats.slice(0, 200));
      } else if (okN > 0) {
        log(`freshness: ${freshStats}`);
        rl.step('freshness+mesh', 'ok', freshStats.slice(0, 200));
      } else if (tryN > 0) {
        log(`freshness: ${freshStats} (percobaan gagal — lihat log)`);
        rl.step('freshness+mesh', 'fail', freshStats.slice(0, 200));
      } else {
        log(`freshness: ${freshStats}`);
        rl.step('freshness+mesh', 'skip', freshStats.slice(0, 200));
      }
    } catch (e) {
      log(`freshness GAGAL: ${e.message}`);
      rl.step('freshness+mesh', 'fail', String(e.message).slice(0, 200));
    }

    const state = readState();
    const s = buildSummary(state);
    const top = mined.slice(0, 10).map((q, i) => `  ${String(i + 1).padStart(2)}. ${q.query} (${q.clicks} klik / ${q.impressions} tayang, pos ${Number(q.position).toFixed(1)})`);
    const clicks = mined.reduce((a, q) => a + q.clicks, 0);
    const impressions = mined.reduce((a, q) => a + q.impressions, 0);

    const tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const judul = `Laporan Mingguan SEO — ${tanggal}`;

    const L = s.labels || {};
    const goodW = [
      { label: 'Artikel tayang', status: 'ok', detail: `${s.total} URL hidup di situs` },
      { label: 'Terukur di GSC', status: 'ok', detail: `${s.measured}/${s.total} artikel sudah dipantau` },
    ];
    if (freshSlugs.length) for (const sl of freshSlugs) goodW.push({ label: 'Disegarkan', status: 'ok', detail: `${SITE}/blog/${sl}/ — ditulis ulang & live` });
    const badW = (s.alerts || []).map((a) => ({ label: a.code || 'Peringatan', status: a.level === 'critical' ? 'fail' : 'warn', detail: a.msg || '' }));
    if (s.indexRate != null && s.indexRate < 0.7) badW.push({ label: 'Cakupan indeks Google', status: 'warn', detail: `${fmtRate(s.indexRate)} terindeks — wajar situs baru` });
    if (!badW.length) badW.push({ label: 'Tidak ada peringatan aktif', status: 'ok', detail: 'semua baik' });

    await sendReport({
      kind: 'mingguan',
      subject: `[${NOTIFY_PREFIX}] ${judul}${minedError ? ' — (mining gagal)' : ''}`,
      title: judul,
      date: tanggal,
      cc: notifyCc(),
      stats: [
        { label: 'Klik (28 hari)', value: clicks },
        { label: 'Tayang (28 hari)', value: impressions },
        { label: 'Artikel tayang', value: s.total },
        { label: 'Cakupan indeks', value: fmtRate(s.indexRate), sub: `terukur ${s.measured}/${s.total}` },
      ],
      sections: [
        { title: 'Yang berjalan baik', items: goodW },
        { title: 'Perlu perhatian', items: badW },
        { title: 'Top Query Google', items: top.length
            ? mined.slice(0, 10).map((q) => ({ label: q.query, status: 'info', detail: `${q.clicks} klik · ${q.impressions} tayang · posisi ${Number(q.position).toFixed(1)}` }))
            : [{ label: 'Belum ada data query', status: 'info', detail: 'Google belum menampilkan query untuk situs baru' }] },
        { title: 'Status indeks', items: [
          { label: 'Terindeks', status: 'ok', detail: String(L.indexed || 0) },
          { label: 'Belum terindeks', status: 'warn', detail: String(L.not_indexed || 0) },
          { label: 'Belum ditemukan', status: 'info', detail: String(L.not_discovered || 0) },
        ] },
      ],
    });
    rl.step('report', 'ok', `${NOTIFY_PREFIX} mingguan`);

    rl.summarize({
      published: s.total,
      measured: s.measured,
      indexRate: s.indexRate,
      clicks28d: clicks,
      impressions28d: impressions,
      minedQueries: mined.length,
      miningError: minedError,
    });

    code = minedError ? 1 : 0;
    return code;
  } finally {
    lock.release();
    log('lock dilepas');
    rl.finish(code);
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
