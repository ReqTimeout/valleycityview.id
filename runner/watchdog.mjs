#!/usr/bin/env node
/**
 * runner/watchdog.mjs — deteksi scheduler/pipeline mati (cron tiap 6 jam).
 *
 * READ-ONLY: tidak mengambil lock pipeline, tidak menulis state.json/queue.
 * Hanya membaca runs.json + config + sitemap, lalu alert bila ada yang mati.
 *
 * Sinyal utama = detak jantung scheduler. tick.mjs mencatat run TIAP JAM
 * (termasuk skip di luar jendela), jadi run terbaru seharusnya <= 1 jam.
 * Bila > watchdogPublishMaxH (2j) → cron tick kemungkinan mati. Entri watchdog
 * sendiri diabaikan supaya tidak menutupi sinyal.
 *
 * Sitemap: di container dist TIDAK dibangun (publish-git push ke Cloudflare
 * Pages yang build). Jadi "sitemap tidak ada" hanya alert di mesin lokal;
 * di container dicek hanya bila berkasnya memang ada dan basi.
 *
 * Email hanya dikirim bila ADA alert (hindari spam tiap 6 jam saat sehat).
 * Env: WATCHDOG_PUBLISH_H/REPORT_H/RUN_H · RESEND_API_KEY · NOTIFY_EMAIL_*.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { openRun } from './lib/runlog.mjs';
import { sendReport } from './lib/notify.mjs';
import { lockStatus } from './lib/lock.mjs';
import { CFG, inContainer } from './lib/config.mjs';
import { RUNS_PATH, CONFIG_PATH, SITEMAP_PATH } from '../seo/paths.mjs';
import { NOTIFY_PREFIX } from '../seo/site.mjs';

const log = (m) => console.log(`[watchdog] ${m}`);
const readJson = (p, f) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return f; } };
const hoursSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : null);

async function main() {
  const rl = openRun('watchdog');
  const alerts = [];

  const runs = readJson(RUNS_PATH, { runs: [] }).runs || [];
  const others = runs.filter((r) => r.kind !== 'watchdog');
  const newest = others[0] || null;
  const newestAge = hoursSince(newest?.at);

  if (!newest) {
    alerts.push({ level: 'bad', code: 'no-runs', msg: 'Belum ada run pipeline tercatat (daily/tick/weekly). Scheduler belum pernah jalan.' });
  } else if (newestAge > CFG.watchdogPublishMaxH) {
    alerts.push({ level: 'bad', code: 'scheduler', msg: `Run terbaru (${newest.kind}) berumur ${newestAge.toFixed(1)}j > ${CFG.watchdogPublishMaxH}j — cron tick kemungkinan mati.` });
  }

  const lastDaily = others.find((r) => r.kind === 'daily');
  const dailyAge = hoursSince(lastDaily?.at);
  if (lastDaily && dailyAge > 26) {
    alerts.push({ level: 'warn', code: 'daily', msg: `Pipeline harian terakhir ${dailyAge.toFixed(1)}j lalu (>26j) — daily mungkin tidak terpicu.` });
  }

  let smAge = null;
  if (existsSync(SITEMAP_PATH)) {
    smAge = (Date.now() - statSync(SITEMAP_PATH).mtimeMs) / 3600000;
    if (smAge > CFG.watchdogReportMaxH) {
      alerts.push({ level: 'warn', code: 'sitemap', msg: `Sitemap berumur ${smAge.toFixed(1)}j > ${CFG.watchdogReportMaxH}j — build/deploy mungkin mati.` });
    }
  } else if (!inContainer) {
    alerts.push({ level: 'warn', code: 'sitemap', msg: 'Sitemap tidak ada di disk — jalankan npm --prefix site run build.' });
  }

  const cfg = readJson(CONFIG_PATH, {});
  if (cfg.halt === true) {
    alerts.push({ level: 'warn', code: 'halt', msg: `config.halt=true — pipeline sengaja dihentikan: ${cfg.halt_reason || 'tanpa alasan'}.` });
  }

  const lk = lockStatus();
  if (lk && !lk.corrupt && lk.host === hostname()) {
    try { process.kill(lk.pid, 0); }
    catch { alerts.push({ level: 'warn', code: 'lock', msg: `Lock dipegang pid ${lk.pid} yang sudah mati (${lk.name}, sejak ${lk.at}). Dibersihkan saat acquire berikutnya.` }); }
  }

  rl.step('check', alerts.length ? 'warn' : 'ok', `${alerts.length} alert`);
  rl.summarize({ alerts: alerts.length, newestRunAgeH: newestAge, dailyAgeH: dailyAge, sitemapAgeH: smAge });

  if (alerts.length) {
    await sendReport({
      subject: `[${NOTIFY_PREFIX}] watchdog — ${alerts.length} masalah`,
      heading: 'SEO engine valleycity.id — watchdog',
      lines: [
        `Run terbaru: ${newest ? `${newest.kind}, ${newestAge.toFixed(1)}j lalu` : 'tidak ada'}`,
        `Sitemap: ${smAge != null ? `${smAge.toFixed(1)}j` : 'tidak ada di disk'}`,
        ...alerts.map((a) => `${a.level}: ${a.msg}`),
      ],
      alerts,
    });
  }

  rl.finish(0);
  log(`${alerts.length} alert${alerts.length ? '' : ' — sehat'}`);
  return 0;
}

main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exitCode = 1; });
