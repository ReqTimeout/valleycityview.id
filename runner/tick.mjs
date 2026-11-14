#!/usr/bin/env node
/**
 * runner/tick.mjs — catch-up publish per jam (cron Coolify `0 * * * *`).
 *
 * Kenapa ada: daily jalan sekali 06:00 WIB. Kalau daily gagal, atau kuota
 * harian belum terpenuhi (draft baru muncul siang hari), tick mengejar sisa
 * kuota SATU per jam selama jendela kerja — bukan memborong sekaligus.
 *
 * Gerbang TIDAK dilewati: tick hanya memicu publishScript yang sama (di
 * container = publish-git.mjs, gate qc-uniqueness tetap berkuasa). Tick tidak
 * generate, tidak indexer, tidak menyetujui keyword.
 *
 * Setiap jam.tick mencatat run ke runs.json — TERMASUK saat skip di luar
 * jendela. Itu sengaja: watchdog memakai "run terbaru" sebagai detak jantung
 * scheduler. Kalau tick hanya mencatat saat publish, malam hari tampak mati.
 *
 * Kuota "hari ini" dihitung dari stempel `published YYYY-MM-DD` di queue
 * (tanggal UTC, sama dengan flipDraft publish-git). Dalam jendela 09–16 WIB
 * (= 02–09 UTC) tanggal UTC == tanggal WIB, jadi keduanya konsisten.
 *
 * Env: SEO_TICK_START/END (jam WIB, default 9–16) · GITHUB_TOKEN ·
 *      CLOUDFLARE_API_TOKEN/ACCOUNT_ID · SEO_SKIP_PUBLISH=1 (uji).
 * Exit: 0 = aman/skip, 1 = publish gagal.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { acquireLock } from './lib/lock.mjs';
import { openRun } from './lib/runlog.mjs';
import { CFG, publishScript } from './lib/config.mjs';
import { QUEUE_PATH, CONFIG_PATH } from '../seo/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const log = (m) => console.log(`[tick] ${m}`);

const readJson = (p, f) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return f; } };

function run(script, args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(ROOT, script), ...args], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    c.on('error', (e) => resolve({ code: 1, error: e.message }));
    c.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

/** Jam WIB sekarang — lewat Intl, tidak bergantung TZ env host (UTC). */
function wibHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: CFG.tz, hour: '2-digit', hour12: false }).format(new Date()));
}
const todayStamp = () => new Date().toISOString().slice(0, 10);

function publishedToday(queue) {
  const stamp = `published ${todayStamp()}`;
  return (queue.items || []).filter((i) => i.status === 'published' && String(i.notes || '').includes(stamp)).length;
}
const countDrafts = (queue) => (queue.items || []).filter((i) => i.status === 'draft').length;

async function main() {
  const rl = openRun('tick');
  const hour = wibHour();

  if (hour < CFG.tickWindowStart || hour >= CFG.tickWindowEnd) {
    log(`di luar jendela (${hour}:00 WIB, jendela ${CFG.tickWindowStart}–${CFG.tickWindowEnd}) — skip`);
    rl.step('window', 'skip', `${hour}:00 WIB di luar ${CFG.tickWindowStart}–${CFG.tickWindowEnd}`);
    rl.finish(0);
    return 0;
  }

  // Timeout pendek: kalau daily sedang jalan, tick mengalah (bukan menunggu 5 menit).
  const lock = await acquireLock('tick', { timeoutMs: 20000, pollMs: 2000 });
  if (!lock.acquired) {
    const why = `pid ${lock.holder?.pid} di ${lock.holder?.host}, mulai ${lock.holder?.at}`;
    log(`SKIP — lock dipegang run lain (${why})`);
    rl.setLock('held-by-other', why);
    rl.finish(0);
    return 0;
  }

  let code = 0;
  try {
    const cfg = readJson(CONFIG_PATH, {});
    const queue = readJson(QUEUE_PATH, { items: [] });
    const dailyCount = Number(cfg.daily_count ?? 1);
    const done = publishedToday(queue);
    const drafts = countDrafts(queue);

    if (cfg.halt === true) {
      rl.step('publish', 'blocked', `halt=true: ${cfg.halt_reason || 'tanpa alasan'}`);
    } else if (process.env.SEO_SKIP_PUBLISH === '1') {
      rl.step('publish', 'skip', 'SEO_SKIP_PUBLISH=1');
    } else if (!(process.env.GITHUB_TOKEN && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)) {
      rl.step('publish', 'skip', 'GITHUB_TOKEN / CLOUDFLARE_API_TOKEN / ACCOUNT_ID belum di-set');
    } else if (dailyCount <= 0) {
      rl.step('publish', 'skip', 'daily_count=0');
    } else if (done >= dailyCount) {
      rl.step('publish', 'skip', `kuota harian terpenuhi (${done}/${dailyCount})`);
    } else if (drafts <= 0) {
      rl.step('publish', 'skip', 'tidak ada draft siap publish');
    } else {
      log(`jalan: ${publishScript} --count=1 (kuota ${done}/${dailyCount}, draft ${drafts})`);
      const r = await run(publishScript, ['--count=1']);
      code = r.code;
      rl.step('publish', code === 0 ? 'ok' : 'fail', `--count=1, exit ${code}`);
    }

    rl.summarize({ dailyCount, publishedToday: done, drafts, hour });
    return code;
  } finally {
    lock.release();
    rl.finish(code);
  }
}

main()
  .then((c) => { log(`exit ${c}`); process.exitCode = c; })
  .catch((e) => { console.error(`FATAL: ${e.message}`); process.exitCode = 1; });
