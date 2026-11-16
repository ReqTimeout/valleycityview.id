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

  // ── POSTINGAN alert dashboard (halaman /alerts) ────────────────────────────
  // Halaman /alerts itu PASIF: tanpa langkah ini tidak satu pun catatannya
  // sampai ke email siapa pun (watchdog lama hanya mengecek kesehatan pipeline
  // sendiri). Watchdog jalan tiap 30 menit → kirim ke internal (TANPA cc klien)
  // HANYA saat daftar catatan BERUBAH (hash), supaya pos yang sama tidak
  // membanjiri inbox.
  try {
    let st = {};
    try { st = JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { st = {}; }
    const { posts } = await import('../seo/lib/live-posts.mjs');
    const { inventory } = await import('../seo/tracking.mjs');
    const dash = [];
    if (st.rampGate && st.rampGate.alert) {
      dash.push({ kind: (st.rampGate.alert.level === 'critical' ? 'bad' : 'warn'), code: st.rampGate.alert.code || 'ramp', msg: st.rampGate.alert.msg || '' });
    }
    if (st.remedyAlert) {
      dash.push({ kind: 'warn', code: 'remedy', msg: st.remedyAlert.msg || st.remedyAlert.message || JSON.stringify(st.remedyAlert).slice(0, 160) });
    }
    const accessMode = process.env.DASHBOARD_ACCESS || 'not-configured';
    if (accessMode !== 'enforced') {
      dash.push({ kind: 'bad', code: 'access', msg: 'Access ' + accessMode + ' — halaman ini hanya terlindungi oleh tidak terindeks; itu BUKAN proteksi.' });
    }
    try {
      const pubUrls = new Set((st.published || []).map((p) => (typeof p === 'string' ? p : p.url || '')));
      const missing = posts().filter((p) => p.live && !pubUrls.has(`https://valleycityview.id/blog/${p.slug}/`) && !pubUrls.has(`https://valleycityview.id/blog/${p.slug}`)).length;
      if (missing > 0) dash.push({ kind: 'warn', code: 'uncatalogued', msg: `${missing} artikel tayang belum tercatat di state — pencatatan berjalan otomatis tiap pagi.` });
    } catch { /* inventaris gagal → lewati, jangan gagalkan watchdog */ }
    try {
      const thin = inventory().published.filter((a) => a.words < 900).length;
      if (thin > 0) dash.push({ kind: 'info', code: 'thin', msg: `${thin} artikel masih pendek (<900 kata) — kandidat dijalankan freshness tiap Senin.` });
    } catch { /* tracking gagal → lewati */ }
    const creds = ['QWEN_API_KEY', 'GSC_SERVICE_ACCOUNT_JSON_B64', 'BING_API_KEY', 'RESEND_API_KEY', 'NOTIFY_EMAIL_TO'].filter((k) => !process.env[k]);
    if (creds.length) dash.push({ kind: 'warn', code: 'credentials', msg: `Kredensial belum terpasang: ${creds.join(', ')} — pekerjaan terkait dilewati dan dilaporkan jujur.` });

    const hash = createHash('sha1').update(JSON.stringify(dash)).digest('hex').slice(0, 16);
    const prev = (st.alertPost && st.alertPost.hash) || '';
    const saveAlertPost = (rec) => {
      try {
        // BACA ULANG state dari disk — object `st` dimuat SEBELUM sendReport;
        // menulis `st` mentah akan menimpa baris riwayat laporan yang baru saja
        // direkam sendReport (insiden: baris 'Peringatan' hilang dari /laporan).
        let cur = {};
        try { cur = JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { cur = st; }
        cur.alertPost = rec;
        const tmp = `${STATE_PATH}.tmp`;
        writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n');
        renameSync(tmp, STATE_PATH);
      } catch (e) { log(`catat alertPost gagal: ${e.message}`); }
    };
    if (dash.length && hash !== prev) {
      const LVL = { bad: 'KRITIS', warn: 'PERHATIAN', info: 'INFO' };
      const r = await sendReport({
        kind: 'alerts',
        tone: 'alert',
        cc: false,
        subject: `[${NOTIFY_PREFIX}] Peringatan dashboard — ${dash.length} catatan aktif`,
        title: `Perlu tindakan — ${dash.length} catatan di halaman Perlu Perhatian`,
        sections: [
          { title: 'Catatan aktif', body: dash.map((a, i) => `  ${i + 1}. [${LVL[a.kind] || 'INFO'}] ${a.msg}`).join('\n') },
          { title: 'Sumber', body: `  Daftar ini identik dengan halaman /alerts — dikirim otomatis saat daftar berubah.\n  Rincian: https://valleycity.beriklan.co.id/alerts` },
        ],
      });
      saveAlertPost({ hash, at: new Date().toISOString(), sent: r.sent, count: dash.length });
      log(`posting alert dashboard: ${dash.length} catatan → email internal (${r.sent ? 'terkirim id ' + r.id : 'GAGAL ' + (r.reason || '')})`);
      rl.step('alert-post', r.sent ? 'ok' : 'fail', `${dash.length} catatan · hash ${hash}`);
    } else if (!dash.length && prev) {
      saveAlertPost({ hash: '', at: new Date().toISOString(), sent: false, count: 0 });
      log('posting alert dashboard: semua catatan bersih — pos direset');
    } else if (!dash.length) {
      log('posting alert dashboard: tidak ada catatan aktif');
    } else {
      log(`posting alert dashboard: tidak berubah (hash ${hash}) — tidak dikirim ulang`);
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
