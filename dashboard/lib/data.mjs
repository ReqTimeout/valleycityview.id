/**
 * dashboard/lib/data.mjs — baca keadaan mesin apa adanya, lalu sajikan satu
 * objek snapshot untuk semua halaman.
 *
 * Aturan yang dijaga di sini:
 * 1. Tidak ada angka yang dikarang. Kalau sebuah pengukuran belum pernah
 *    terjadi, nilainya `null` dan halaman yang bersangkutan menulis
 *    "belum ada pengukuran" — bukan 0, bukan "100% gagal", bukan grafik kosong
 *    yang terlihat seperti data.
 * 2. Tidak ada pembacaan file di luar daftar ini. Halaman hanya menerima
 *    snapshot, supaya tidak ada satu pun route yang bisa ikut membuka berkas.
 * 3. Kredensial hanya boleh terlihat sebagai "ter-set / belum" — nama env, tidak
 *    pernah nilainya.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  STATE_PATH,
  CONFIG_PATH,
  QUEUE_PATH,
  KEYWORDS_PATH,
  CITIES_PATH,
  RUNS_PATH,
  AUDIT_DECISIONS_PATH,
  SITEMAP_PATH,
  DIST_DIR,
} from '../../seo/paths.mjs';
import { SITE, BRAND } from '../../seo/site.mjs';
import { buildSummary } from '../../seo/lib/summary.mjs';
import { posts } from '../../seo/lib/live-posts.mjs';
// Lokasi dan isi lock dimiliki runner/lib/lock.mjs. Dashboard tidak menebak
// path-nya sendiri — kalau suatu hari lock pindah ke volume, satu-satunya yang
// perlu berubah tetap di sana.
import { lockStatus } from '../../runner/lib/lock.mjs';

const MINED_PATH = process.env.SEO_MINED_PATH || join(ROOT, 'seo/keywords.mined.json');

/**
 * Path di layar selalu relatif terhadap root repo. Path absolut mesin build
 * (di laptop saya /Volumes/..., di container /app/...) tidak ada gunanya bagi
 * pembaca dan justru membuat angka terlihat berbeda antara dua environment.
 */
function rel(path) {
  return String(path).startsWith(ROOT + '/') ? path.slice(ROOT.length + 1) : String(path);
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function ageHours(path) {
  try {
    return Math.round((Date.now() - statSync(path).mtimeMs) / 36e5 * 10) / 10;
  } catch {
    return null;
  }
}

function mtimeIso(path) {
  try {
    return new Date(statSync(path).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

function envSet(name) {
  return Boolean(process.env[name]);
}

/** Hari WIB (UTC+7) dalam format YYYY-MM-DD — dasar KPI "hari ini". */
function wibDay(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 864e5));
}
/** Jam WIB (0-23) — hourCycle h23 supaya tengah malam = 0, bukan 24. */
function wibHour() {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false, hourCycle: 'h23',
  }).format(new Date()));
}
const dayKey = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Hitung KPI "hari ini" + deret 14 hari dari stempel generatedAt/publishedAt
 * (tanggal WIB). Angka nol di hari tanpa kegiatan = NOL NYATA, bukan kosong.
 */
function produksiHariIni(items) {
  const today = wibDay();
  const countOn = (field, day) => items.filter((i) => dayKey(i[field]) === day).length;
  const series = (field) => {
    const m = {};
    for (const i of items) {
      const d = dayKey(i[field]);
      if (d) m[d] = (m[d] || 0) + 1;
    }
    return Array.from({ length: 14 }, (_, k) => {
      const day = wibDay(k - 13);
      return { day, n: m[day] || 0 };
    });
  };
  return {
    today,
    createdToday: countOn('generatedAt', today),
    publishedToday: countOn('publishedAt', today),
    createdSeries: series('generatedAt'),
    publishedSeries: series('publishedAt'),
  };
}

/**
 * Jadwal tayang: kapan tik berikutnya boleh menerbitkan (jendela jam WIB +
 * kuota harian + ketersediaan draf). Tanpa publishAt per artikel — tik mengejar
 * kuota 1/jam selama jendela, jadi "berikutnya" = tik berikutnya selama masih
 * ada yang bisa diterbitkan. Alasan selalu dijelaskan apa adanya.
 */
function nextTik(schedule, { drafts, publishedToday, halt }) {
  const { startHour, endHour, dailyCount } = schedule;
  const reason = (r) => ({ at: null, inWindow: false, reason: r });
  if (halt) return reason('dihentikan manual (halt)');
  if (!(startHour != null && endHour != null)) return reason('jendela tik belum dikonfigurasi');
  if (drafts <= 0) return reason('belum ada draf siap tayang');
  if (dailyCount != null && publishedToday >= dailyCount) return reason(`kuota ${dailyCount}/hari sudah terpenuhi`);
  const nowH = wibHour();
  const inWindow = nowH >= startHour && nowH < endHour;
  // Tik jalan tiap jam tepat. Kandidat = jam pertama yang VALID di jendela
  // (start..end-1): naik ke start kalau masih pagi, lompat ke start besok
  // kalau hari ini jendela sudah tutup.
  let h = nowH + 1;
  if (h < startHour) h = startHour;
  let dayOffset = 0;
  if (h >= endHour) { h = startHour; dayOffset = 1; }
  // Bangun ISO (WIB → UTC): jam 00 WIB = 17:00 UTC hari sebelumnya.
  const wibMidnightUtc = Date.parse(`${wibDay(dayOffset)}T00:00:00+07:00`);
  const at = new Date(wibMidnightUtc + h * 36e5).toISOString();
  return { at, inWindow, reason: inWindow ? 'dalam jendela — menunggu tik berikutnya' : 'di luar jendela — menunggu jendela buka' };
}

/** Env yang dibutuhkan pipeline — nama saja, nilai tidak pernah dibaca. */
function credentials() {
  return [
    { env: 'QWEN_API_KEY', role: 'penulis artikel (Qwen)', neededBy: 'generate' },
    { env: 'GITHUB_TOKEN', role: 'push hasil ke repo', neededBy: 'publish' },
    { env: 'CLOUDFLARE_API_TOKEN', role: 'tunggu deploy Pages', neededBy: 'publish' },
    { env: 'CLOUDFLARE_ACCOUNT_ID', role: 'tunggu deploy Pages', neededBy: 'publish' },
    { env: 'GSC_SERVICE_ACCOUNT_JSON_B64', role: 'inspeksi indeks + riwayat harian', neededBy: 'indexer|history' },
    { env: 'BING_API_KEY', role: 'submit Bing (IndexNow tidak butuh ini)', neededBy: 'bing-submit' },
    { env: 'RESEND_API_KEY', role: 'laporan email', neededBy: 'notify' },
    { env: 'NOTIFY_EMAIL_TO', role: 'penerima laporan', neededBy: 'notify' },
  ].map((c) => ({ ...c, set: envSet(c.env) }));
}

/** Umur sitemap + tanggal lastmod tertua/terbaru yang benar-benar ada di file. */
function sitemapInfo(state) {
  const xml = existsSync(SITEMAP_PATH) ? readFileSync(SITEMAP_PATH, 'utf8') : '';
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]).sort();
  const file = {
    exists: xml.length > 0,
    path: rel(SITEMAP_PATH),
    urls: urls.length,
    withLastmod: mods.length,
    oldest: mods[0] || null,
    newest: mods[mods.length - 1] || null,
    ageHours: ageHours(SITEMAP_PATH),
    via: 'file',
  };
  if (file.exists) return file;
  // Container TIDAK memuat dist/ (build jalan di CF Pages) — fallback ke
  // hasil pemeriksaan langsung seo/site-checks.mjs yang menghitung <loc>
  // dari sitemap live. Jujur: ada kalau benar-benar terukur, bukan nol karangan.
  const live = state?.checks?.sitemap;
  if (live?.status === 'ok' && live.urls > 0) {
    return {
      exists: true, path: live.child ? new URL(live.child).pathname : '/sitemap-index.xml',
      urls: live.urls, withLastmod: null, oldest: null, newest: null,
      ageHours: live.checkedAt ? Math.round((Date.now() - Date.parse(live.checkedAt)) / 36e5 * 10) / 10 : null,
      via: 'live',
    };
  }
  return file;
}

function auditInfo() {
  const doc = readJson(AUDIT_DECISIONS_PATH, { decisions: {} });
  const entries = Object.entries(doc.decisions || {});
  const keep = entries.filter(([, d]) => d?.action === 'keep');
  const redirect = entries.filter(([, d]) => d?.action === 'redirect');
  return { total: entries.length, keep: keep.length, redirect: redirect.length, entries };
}

/**
 * Trafik hanya ada kalau weekly.mjs sudah pernah berhasil menambang Search
 * Analytics. Berkas itu berisi window 28 hari — window 7 dan 90 hari memang
 * belum pernah diambil, jadi dilaporkan apa adanya, bukan dinolkan.
 */
function trafficInfo() {
  const doc = readJson(MINED_PATH);
  if (!doc?.queries?.length) {
    return { available: false, path: rel(MINED_PATH), windowDays: null, clicks: 0, impressions: 0, top: [] };
  }
  const q = doc.queries;
  return {
    available: true,
    path: rel(MINED_PATH),
    minedAt: doc._meta?.minedAt || null,
    windowDays: doc._meta?.windowDays ?? null,
    queries: q.length,
    clicks: q.reduce((a, x) => a + (x.clicks || 0), 0),
    impressions: q.reduce((a, x) => a + (x.impressions || 0), 0),
    top: q.slice(0, 15),
  };
}

/**
 * Status Cloudflare Access. Ini TIDAK bisa disimpulkan dari berkas repo —
 * Access di-set di dashboard Cloudflare, jadi satu-satunya cara jujur adalah
 * menyatakannya lewat environment saat deploy. Defaultnya 'not-configured':
 * halaman tidak boleh mengklaim diri terlindungi kalau tidak ada yang
 * menyatakannya.
 */
function accessInfo() {
  const mode = process.env.DASHBOARD_ACCESS || 'not-configured';
  const known = ['enforced', 'enforce-off', 'not-configured'];
  return {
    mode: known.includes(mode) ? mode : 'unknown',
    label: mode,
    note: {
      enforced: 'Akses dibatasi email allow-list di level app — tanpa login Access halaman ini tidak disajikan.',
      'enforce-off': 'Access terpasang tapi mode enforce OFF: siapa pun yang tahu URL-nya bisa masuk. Tidak terindeks, belum terlindungi.',
      'not-configured': 'Access belum dikonfigurasi. Halaman ini hanya terlindungi oleh tidak terindeks — itu BUKAN proteksi.',
      unknown: 'Nilai DASHBOARD_ACCESS tidak dikenal, jadi status proteksi tidak bisa dinyatakan.',
    }[known.includes(mode) ? mode : 'unknown'],
  };
}

/**
 * Jadwal publikasi otomatis, dibaca langsung dari konfigurasi yang memakai
 * runner (env jendela jam + kuota harian di config). Ini angka operasional,
 * bukan rahasia, dan jadi sumber tunggal halaman progres di beranda.
 */
function scheduleInfo(config) {
  const start = Number(process.env.SEO_TICK_START ?? 9);
  const end = Number(process.env.SEO_TICK_END ?? 16);
  return {
    startHour: Number.isFinite(start) ? start : null,
    endHour: Number.isFinite(end) ? end : null,
    dailyCount: config.daily_count ?? null,
    halt: Boolean(config.halt),
  };
}

export function collect() {
  const state = readJson(STATE_PATH, {}) || {};
  const config = readJson(CONFIG_PATH, {}) || {};
  const queue = readJson(QUEUE_PATH, { items: [] }) || { items: [] };
  const keywords = readJson(KEYWORDS_PATH, { items: [] }) || { items: [] };
  const cities = readJson(CITIES_PATH, []);
  const runs = readJson(RUNS_PATH, { runs: [] }) || { runs: [] };

  const summary = buildSummary(state);
  summary.dailyCount = config.daily_count ?? null;
  const schedule = scheduleInfo(config);
  const items = queue.items || [];
  const produksi = produksiHariIni(items);
  const draftsNow = items.filter((i) => i.status === 'draft').length;
  const nt = nextTik(schedule, { drafts: draftsNow, publishedToday: produksi.publishedToday, halt: schedule.halt });
  schedule.drafts = draftsNow;
  schedule.publishedToday = produksi.publishedToday;
  schedule.quotaLeft = schedule.dailyCount != null ? Math.max(0, schedule.dailyCount - produksi.publishedToday) : null;
  schedule.nowHour = wibHour();
  schedule.inWindow = nt.inWindow;
  schedule.nextAt = nt.at;
  schedule.nextReason = nt.reason;

  const allPosts = posts();
  const live = allPosts.filter((p) => p.live);
  const bySlug = Object.fromEntries(live.map((p) => [p.slug, p]));

  // Baris URLs: hanya yang tayang. Yang 301 bukan kandidat indeks — Google
  // harus melihat redirect, bukan halaman.
  const inspections = state.gsc?.inspections || {};
  const indexnow = new Set(state.indexnow?.submitted || []);
  const urlRows = (state.published || []).map((p) => {
    const insp = inspections[p.url] || null;
    return {
      slug: p.slug,
      url: p.url,
      firstSeen: p.firstSeen || bySlug[p.slug]?.date || null,
      label: p.indexed || 'unknown',
      lastChecked: p.lastChecked || null,
      verdict: insp?.verdict ?? null,
      coverageState: insp?.coverageState ?? null,
      indexing: insp?.indexingState ?? null,
      lastCrawlTime: insp?.lastCrawlTime ?? null,
      submitted: indexnow.has(p.url),
    };
  });
  // URL yang ada di collection tapi tidak tercatat di state = mesin belum
  // pernah melihatnya; ini yang biasanya terlewat dan tidak pernah muncul.
  const known = new Set((state.published || []).map((p) => p.slug));
  const missing = live.filter((p) => !known.has(p.slug)).map((p) => ({ slug: p.slug, title: p.title, date: p.date }));

  const kwItems = keywords.items || [];
  const queuedSlugs = new Set((queue.items || []).map((i) => i.slug));
  const usedSlugs = new Set(allPosts.map((p) => p.slug));

  const draftish = allPosts.filter((p) => p.status === 'draft' || p.status === 'review');
  const audit = auditInfo();

  // Umur berkas state = kapan terakhir kali mesin menulis, bukan kapan ia
  // seharusnya menulis. Ditampilkan apa adanya di halaman Health.
  const fileRows = [
    [STATE_PATH, `${summary.total} URL tercatat`],
    [CONFIG_PATH, `daily_count ${config.daily_count ?? '—'} · ${config.updated_by || 'tanpa catatan'}`],
    [QUEUE_PATH, `${(queue.items || []).length} item`],
    [RUNS_PATH, `${(runs.runs || []).length} run`],
    [KEYWORDS_PATH, `${(keywords.items || []).length} keyword · approved_at ${keywords._meta?.approved_at || 'null'}`],
    [AUDIT_DECISIONS_PATH, `${audit.total} keputusan · ${audit.keep} keep, ${audit.redirect} redirect`],
  ].map(([p, note]) => ({ path: rel(p), mtime: mtimeIso(p), note }));

  return {
    generatedAt: new Date().toISOString(),
    brand: BRAND,
    site: SITE,
    counts: {
      files: allPosts.length,
      live: live.length,
      drafts: draftish.length,
      redirects: allPosts.filter((p) => p.redirectTo).length,
    },
    summary,
    schedule,
    stateMeta: state._meta || null,
    config,
    ramp: { lastRun: state.rampGate?.lastRun || null, alert: state.rampGate?.alert || null, history: config.history || [] },
    bing: state.bing?.lastRun || null,
    gscRun: state.gsc?.lastRun || null,
    indexer: state.indexer?.lastRun || null,
    indexnow: { submitted: state.indexnow?.submitted?.length || 0 },
    indexnowKey: {
      path: rel(join(ROOT, 'site/public/indexnow.txt')),
      exists: existsSync(join(ROOT, 'site/public/indexnow.txt')),
      servedAt: `${SITE}/indexnow.txt`,
    },
    produksi,
    // Deret metrik harian + agregat GSC (ditulis seo/gsc-history.mjs harian).
    gsc: {
      agg: state.gsc?.agg || null,
      history: state.gsc?.history || null,
      topPages: state.gsc?.topPages || null,
      historyAt: state.gsc?.historyAt || null,
      historyNote: state.gsc?.historyNote || null,
    },
    // Pemeriksaan langsung ke situs hidup (seo/site-checks.mjs harian).
    checks: state.checks || null,
    // Riwayat laporan email (state.reports, direkam notify.mjs).
    reports: (state.reports || []).slice(0, 60),
    reportsEnv: {
      to: process.env.NOTIFY_EMAIL_TO || null,
      from: process.env.NOTIFY_EMAIL_FROM || null,
      configured: envSet('RESEND_API_KEY') && envSet('NOTIFY_EMAIL_TO') && envSet('NOTIFY_EMAIL_FROM'),
      dailyAt: '06:00 WIB', // cron task harian (UTC 23:00) di Coolify
    },
    queue: {
      // Per-item ringkas: dipakai chip status per kata kunci + KPI hari ini.
      items: items.map((i) => ({
        slug: i.slug, status: i.status, priority: i.priority ?? null,
        category: i.category || null, intent: i.intent || null,
        generatedAt: i.generatedAt || null, publishedAt: i.publishedAt || null,
      })),
      counts: (queue.items || []).reduce((a, i) => {
        a[i.status] = (a[i.status] || 0) + 1;
        return a;
      }, {}),
      total: (queue.items || []).length,
      slugs: [...queuedSlugs],
      generatedAt: queue._meta?.generated_at || null,
    },
    keywords: {
      approvedAt: keywords._meta?.approved_at || null,
      approvedBy: keywords._meta?.approved_by || null,
      minApproved: keywords._meta?.min_approved ?? null,
      total: kwItems.length,
      approved: kwItems.filter((k) => k.approved).length,
      unused: kwItems.filter((k) => k.approved && !usedSlugs.has(k.slug)).length,
      suggested: kwItems.filter((k) => k.approved === false).length,
      items: kwItems,
    },
    cities: Array.isArray(cities) ? cities : cities?.cities || [],
    audit,
    traffic: trafficInfo(),
    sitemap: sitemapInfo(state),
    distExists: existsSync(DIST_DIR),
    access: accessInfo(),
    runs: (runs.runs || []).slice(0, 60),
    files: fileRows,
    runsTotal: (runs.runs || []).length,
    runsPath: rel(RUNS_PATH),
    lock: lockStatus(),
    urlRows,
    missing,
    recent: live
      .filter((p) => p.updated && Date.parse(p.updated) > Date.now() - 30 * 864e5)
      .sort((a, b) => (a.updated < b.updated ? 1 : -1)),
    posts: allPosts,
    drafts: draftish,
    credentials: credentials(),
  };
}
