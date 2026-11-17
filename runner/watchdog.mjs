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
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { openRun } from './lib/runlog.mjs';
import { sendReport } from './lib/notify.mjs';
import { lockStatus } from './lib/lock.mjs';
import { CFG, inContainer } from './lib/config.mjs';
import { RUNS_PATH, CONFIG_PATH, SITEMAP_PATH, STATE_PATH } from '../seo/paths.mjs';
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
    // Alert HANYA ke internal (NOTIFY_EMAIL_TO) — tanpa cc klien (pola sbdental:
    // masalah pipeline tidak boleh menyampah ke inbox klien).
    await sendReport({
      kind: 'watchdog',
      tone: 'alert',
      subject: `[${NOTIFY_PREFIX}] watchdog — ${alerts.length} masalah`,
      title: `Perlu tindakan — ${alerts.length} masalah pipeline`,
      cc: false,
      sections: [
        {
          title: 'Kondisi',
          body: [
            `  Run terbaru : ${newest ? `${newest.kind}, ${newestAge.toFixed(1)}j lalu` : 'tidak ada'}`,
            `  Sitemap     : ${smAge != null ? `${smAge.toFixed(1)}j` : 'tidak ada di disk'}`,
          ].join('\n'),
        },
        {
          title: 'Masalah',
          body: alerts.map((a) => `  [${(a.level || 'warn').toUpperCase()}] ${a.msg}`).join('\n'),
        },
      ],
    });
  }

  // ── POSTINGAN alert dashboard (email internal) ─────────────────────────────
  // Hanya masalah PERSISTEN yang layak email: quality_drop (ramp), remedy,
  // access belum enforced, kredensial hilang. Catatan transien/lambat (artikel
  // belum tercatat = self-heal tiap pagi; artikel pendek = freshness Senin)
  // TETAP tampil di /alerts tapi TIDAK memicu email. Dulu count-nya berosilasi
  // tiap tick (missing 0↔5) sehingga hash berubah & email terkirim tiap 30 menit
  // (insiden 17 Nov: "kok mengirim email terus"). Sekarang dedupe pakai CODE-SET
  // (bukan count/detail) + cooldown 6 jam anti-burst.
  try {
    let st = {};
    try { st = JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { st = {}; }
    const persist = [];
    if (st.rampGate && st.rampGate.alert) {
      persist.push({ kind: (st.rampGate.alert.level === 'critical' ? 'bad' : 'warn'), code: st.rampGate.alert.code || 'ramp', msg: st.rampGate.alert.msg || '' });
    }
    if (st.remedyAlert) {
      persist.push({ kind: 'warn', code: 'remedy', msg: st.remedyAlert.msg || st.remedyAlert.message || JSON.stringify(st.remedyAlert).slice(0, 160) });
    }
    const accessMode = process.env.DASHBOARD_ACCESS || 'not-configured';
    if (accessMode !== 'enforced') {
      persist.push({ kind: 'bad', code: 'access', msg: 'Access ' + accessMode + ' — dashboard belum dilindungi login allow-list/Access.' });
    }
    const creds = ['QWEN_API_KEY', 'GSC_SERVICE_ACCOUNT_JSON_B64', 'BING_API_KEY', 'RESEND_API_KEY', 'NOTIFY_EMAIL_TO'].filter((k) => !process.env[k]);
    if (creds.length) persist.push({ kind: 'warn', code: 'credentials', msg: `Kredensial belum terpasang: ${creds.join(', ')} — pekerjaan terkait dilewati dan dilaporkan jujur.` });

    const codes = persist.map((a) => a.code).sort();
    const hash = createHash('sha1').update(codes.join('|')).digest('hex').slice(0, 16);
    const prev = (st.alertPost && st.alertPost.hash) || '';
    const lastSent = (st.alertPost && st.alertPost.at) ? Date.parse(st.alertPost.at) : 0;
    const COOLDOWN_MS = 6 * 3600000;
    const now = Date.now();
    const saveAlertPost = (rec) => {
      try {
        // BACA ULANG state dari disk — object `st` dimuat SEBELUM sendReport;
        // menulis `st` mentah akan menimpa baris riwayat yang baru direkam.
        let cur = {};
        try { cur = JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { cur = st; }
        cur.alertPost = rec;
        const tmp = `${STATE_PATH}.tmp`;
        writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n');
        renameSync(tmp, STATE_PATH);
      } catch (e) { log(`catat alertPost gagal: ${e.message}`); }
    };
    if (persist.length && hash !== prev && (now - lastSent >= COOLDOWN_MS || !prev)) {
      const LVL = { bad: 'fail', warn: 'warn', info: 'info' };
      const r = await sendReport({
        kind: 'alerts',
        tone: 'alert',
        cc: false,
        subject: `[${NOTIFY_PREFIX}] Peringatan dashboard — ${persist.length} masalah aktif`,
        title: `Perlu tindakan — ${persist.length} masalah persisten`,
        date: new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        sections: [
          { title: 'Masalah aktif', items: persist.map((a) => ({ label: a.code || 'catatan', status: LVL[a.kind] || 'info', detail: a.msg })) },
          { title: 'Sumber', body: 'Email ini hanya untuk masalah persisten (bukan catatan transien seperti artikel pendek). Dikirim saat code-set berubah, maksimum 1 per 6 jam.', note: 'Rincian semua catatan: https://valleycity.beriklan.co.id/alerts' },
        ],
      });
      saveAlertPost({ hash, at: new Date().toISOString(), sent: r.sent, count: persist.length, codes });
      log(`posting alert: ${persist.length} masalah [${codes.join(',')}] → email internal (${r.sent ? 'terkirim id ' + r.id : 'GAGAL ' + (r.reason || '')})`);
      rl.step('alert-post', r.sent ? 'ok' : 'fail', `${persist.length} masalah · hash ${hash}`);
    } else if (persist.length && hash !== prev) {
      log(`posting alert: berubah [${codes.join(',')}] tapi cooldown 6 jam aktif — ditunda (hash ${hash})`);
    } else if (!persist.length && prev) {
      saveAlertPost({ hash: '', at: new Date().toISOString(), sent: false, count: 0, codes: [] });
      log('posting alert: semua masalah persisten bersih — pos direset');
    } else if (!persist.length) {
      log('posting alert: tidak ada masalah persisten (catatan transien hanya di halaman)');
    } else {
      log(`posting alert: tidak berubah (hash ${hash}) — tidak dikirim ulang`);
    }
  } catch (e) {
    log(`posting alert dashboard GAGAL: ${e.message}`);
    rl.step('alert-post', 'fail', String(e.message).slice(0, 160));
  }

  rl.finish(0);
  log(`${alerts.length} alert${alerts.length ? '' : ' — sehat'}`);
  return 0;
}

main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exitCode = 1; });
