#!/usr/bin/env node
/**
 * seo/gsc-history.mjs — ambil deret metrik HARIAN + halaman teratas dari
 * Search Analytics (30 hari) → state.gsc.history / state.gsc.topPages /
 * state.gsc.agg. Sumber chart tren di dashboard (line klik+tayangan, posisi,
 * tabel riwayat harian, halaman teratas).
 *
 * Kenapa terpisah dari gsc-inspect: inspect = per-URL (URL Inspection API),
 * ini = agregat harian (Search Analytics query). Dijalankan harian oleh
 * runner/daily.mjs SETELAH indexer, non-fatal — GSC kosong/gagal cukup
 * dicatat apa adanya (dashboard menampilkan "belum ada pengukuran", bukan 0).
 *
 * Usage:
 *   node seo/gsc-history.mjs            # 30 hari
 *   node seo/gsc-history.mjs --days 28
 *
 * Env: GSC_SERVICE_ACCOUNT_JSON_B64 | GSC_SA_FILE | GSC_SITE_URL (seo/lib/gsc.mjs)
 * Exit: 0 = selesai/skip (tanpa data bukan error), 1 = state tidak bisa ditulis.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { STATE_PATH } from './paths.mjs';
import { searchAnalytics, SITE_URL } from './lib/gsc.mjs';

function parseArgs(argv) {
  const args = { days: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log(usage()); process.exit(0); }
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  return args;
}
const usage = () => 'node seo/gsc-history.mjs [--days N]';

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}
function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = loadState();
  if (!state) {
    console.log('[history] state.json belum ada — lewat.');
    return 0;
  }

  // Kredensial tidak ada → bukan kegagalan (sama seperti gsc-doctor --auth-only
  // yang hanya dipanggil saat creds terpasang). Tulis penanda "belum".
  const hasCreds = Boolean(process.env.GSC_SERVICE_ACCOUNT_JSON_B64 || process.env.GSC_SA_FILE);
  if (!hasCreds) {
    console.log('[history] GSC credential belum terpasang — deret harian "belum ada pengukuran".');
    state.gsc = { ...(state.gsc || {}), history: null, topPages: null, agg: null, historyAt: new Date().toISOString(), historyNote: 'kredensial GSC belum terpasang' };
    saveState(state);
    return 0;
  }

  const days = Number.isFinite(args.days) && args.days > 0 ? args.days : 30;
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  try {
    // 1) deret harian — dimensi date.
    const daily = await searchAnalytics({ siteUrl: SITE_URL, startDate: start, endDate, dimensions: ['date'], rowLimit: days + 5 });
    const history = (daily || [])
      .map((r) => ({
        date: r.keys?.[0] || null,
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: typeof r.ctr === 'number' ? r.ctr : null,
        position: typeof r.position === 'number' ? Math.round(r.position * 10) / 10 : null,
      }))
      .filter((h) => h.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    // 2) halaman teratas — dimensi page.
    let topPages = [];
    try {
      const pages = await searchAnalytics({ siteUrl: SITE_URL, startDate: start, endDate, dimensions: ['page'], rowLimit: 10 });
      topPages = (pages || []).map((r) => ({
        page: r.keys?.[0] || '',
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: typeof r.ctr === 'number' ? r.ctr : null,
        position: typeof r.position === 'number' ? Math.round(r.position * 10) / 10 : null,
      })).sort((a, b) => b.clicks - a.clicks);
    } catch (e) {
      console.log(`[history] topPages gagal (lanjut): ${String(e.message).slice(0, 120)}`);
    }

    // 3) agregat periode — jumlah klik/tayangan + posisi tertimbang impression.
    const clicks = history.reduce((a, h) => a + h.clicks, 0);
    const impressions = history.reduce((a, h) => a + h.impressions, 0);
    const posSum = history.reduce((a, h) => a + (h.position ?? 0) * (h.impressions || 0), 0);
    const posDen = history.reduce((a, h) => a + (h.impressions || 0), 0);
    const agg = history.length
      ? {
          clicks, impressions,
          ctr: impressions > 0 ? clicks / impressions : null,
          position: posDen > 0 ? Math.round((posSum / posDen) * 10) / 10 : null,
          period: { start: history[0].date, end: history[history.length - 1].date },
        }
      : null;

    state.gsc = {
      ...(state.gsc || {}),
      history: history.length ? history : null,
      topPages: topPages.length ? topPages : null,
      agg,
      historyAt: new Date().toISOString(),
      historyNote: history.length ? null : `tidak ada baris untuk ${start}→${endDate} (situs baru wajar)`,
    };
    saveState(state);
    console.log(`[history] ${history.length} hari · ${topPages.length} halaman · klik ${clicks} · tayang ${impressions} · site ${SITE_URL}`);
    return 0;
  } catch (e) {
    // Gagal total (auth/network): CATAT apa adanya, exit 0 — panggilan harian
    // tidak boleh menggagalkan daily (laporan tetap terkirim dengan jujur).
    console.log(`[history] gagal: ${String(e.message).slice(0, 200)}`);
    state.gsc = { ...(state.gsc || {}), historyAt: new Date().toISOString(), historyNote: `gagal: ${String(e.message).slice(0, 160)}` };
    try { saveState(state); } catch {}
    return 0;
  }
}

main().then((c) => process.exitCode = c).catch((e) => { console.error(`FATAL: ${e.message}`); process.exitCode = 1; });
