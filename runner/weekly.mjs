#!/usr/bin/env node
/**
 * runner/weekly.mjs — pipeline mingguan (Senin 09:00 WIB).
 *
 * Tahap:
 *   1. seo/indexer.mjs            — refresh status index (termasuk ramp-gate hari Senin)
 *   2. mining Search Analytics    — 28 hari → query terbaik → seo/keywords.mined.json
 *   3. freshness + mesh            — belum (butuh repo konten), dicatat sebagai no-op
 *   4. ringkasan + email
 *
 * Env: sama seperti runner/daily.mjs, plus SEO_SKIP_INDEXER=1 untuk uji.
 * Exit: 0 = aman, 1 = gagal.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { acquireLock } from './lib/lock.mjs';
import { sendReport } from './lib/notify.mjs';
import { searchAnalytics } from '../seo/lib/gsc.mjs';

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
  const lock = await acquireLock('weekly');
  if (!lock.acquired) {
    log(`SKIP — masih ada run lain (pid ${lock.holder?.pid}, mulai ${lock.holder?.at})`);
    return 0;
  }
  log('lock diambil');

  try {
    if (process.env.SEO_SKIP_INDEXER !== '1') {
      log('jalan: seo/indexer.mjs (ramp-gate jalan otomatis karena hari Senin)');
      await run('seo/indexer.mjs', []);
    }

    let mined = [];
    let minedError = null;
    try {
      mined = await mineQueries(28);
      saveMined(mined, 28);
      log(`mining: ${mined.length} query disimpan ke ${MINED}`);
    } catch (e) {
      minedError = e.message;
      log(`mining GAGAL: ${e.message}`);
    }

    log('freshness + mesh rebuild: belum aktif (butuh repo konten) — no-op eksplisit');

    const state = readState();
    const labels = (state.published || []).reduce((a, p) => {
      const l = p.indexed || 'unknown';
      a[l] = (a[l] || 0) + 1;
      return a;
    }, {});
    const top = mined.slice(0, 10).map((q) => `${q.query} (${q.clicks}c/${q.impressions}i, pos ${q.position})`);
    const clicks = mined.reduce((a, q) => a + q.clicks, 0);
    const impressions = mined.reduce((a, q) => a + q.impressions, 0);

    await sendReport({
      subject: `[socio-seo] mingguan — ${clicks} klik / ${impressions} imp (28 hari)${minedError ? ' (mining gagal)' : ''}`,
      heading: 'SEO engine socio.id — laporan mingguan',
      lines: [
        `Total klik 28 hari: ${clicks} · impressions: ${impressions}`,
        `URL published: ${(state.published || []).length}`,
        `label: ${Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(' · ') || 'n/a'}`,
        'Top query:',
        ...(top.length ? top : ['(belum ada data query)']),
        `mining disimpan: ${MINED}`,
      ],
      alerts: [state.rampGate?.alert, state.remedyAlert].filter(Boolean),
    });

    return minedError ? 1 : 0;
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
