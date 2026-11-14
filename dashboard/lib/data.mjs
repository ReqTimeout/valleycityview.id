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

/** Env yang dibutuhkan pipeline — nama saja, nilai tidak pernah dibaca. */
function credentials() {
  return [
    { env: 'GROQ_API_KEY', role: 'generator draft', neededBy: 'generate' },
    { env: 'GITHUB_TOKEN', role: 'push hasil ke repo', neededBy: 'publish' },
    { env: 'CLOUDFLARE_API_TOKEN', role: 'tunggu deploy Pages', neededBy: 'publish' },
    { env: 'CLOUDFLARE_ACCOUNT_ID', role: 'tunggu deploy Pages', neededBy: 'publish' },
    { env: 'GSC_SERVICE_ACCOUNT_JSON', role: 'inspeksi indeks + mining query', neededBy: 'indexer|weekly' },
    { env: 'BING_API_KEY', role: 'submit Bing (IndexNow tidak butuh ini)', neededBy: 'bing-submit' },
    { env: 'RESEND_API_KEY', role: 'laporan email', neededBy: 'notify' },
    { env: 'NOTIFY_EMAIL_TO', role: 'penerima laporan', neededBy: 'notify' },
  ].map((c) => ({ ...c, set: envSet(c.env) }));
}

/** Umur sitemap + tanggal lastmod tertua/terbaru yang benar-benar ada di file. */
function sitemapInfo() {
  const xml = existsSync(SITEMAP_PATH) ? readFileSync(SITEMAP_PATH, 'utf8') : '';
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]).sort();
  return {
    exists: xml.length > 0,
    path: rel(SITEMAP_PATH),
    urls: urls.length,
    withLastmod: mods.length,
    oldest: mods[0] || null,
    newest: mods[mods.length - 1] || null,
    ageHours: ageHours(SITEMAP_PATH),
  };
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

export function collect() {
  const state = readJson(STATE_PATH, {}) || {};
  const config = readJson(CONFIG_PATH, {}) || {};
  const queue = readJson(QUEUE_PATH, { items: [] }) || { items: [] };
  const keywords = readJson(KEYWORDS_PATH, { items: [] }) || { items: [] };
  const cities = readJson(CITIES_PATH, []);
  const runs = readJson(RUNS_PATH, { runs: [] }) || { runs: [] };

  const summary = buildSummary(state);
  summary.dailyCount = config.daily_count ?? null;

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
    queue: {
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
    sitemap: sitemapInfo(),
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
