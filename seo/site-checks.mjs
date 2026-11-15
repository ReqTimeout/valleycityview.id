#!/usr/bin/env node
/**
 * seo/site-checks.mjs — pemeriksaan LANGSUNG ke situs yang hidup: robots.txt,
 * sitemap.xml, llms.txt, indexnow.txt, beranda. Hasil ditulis ke
 * state.checks → dashboard (Status Sistem / halaman checks) menampilkan
 * apa adanya, dengan waktu pemeriksaan.
 *
 * Dipanggil harian oleh runner/daily.mjs setelah indexer. Non-fatal: jaringan
 * atau situs sedang error TETAP dicatat sebagai status check (fail jujur),
 * exit 0 supaya laporan harian tetap terkirim.
 *
 * Status per check: ok | warn | fail  (detail membawa HTTP + ukuran/konten)
 * Exit: 0 selalu (kecuali state tidak bisa ditulis → 1).
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { STATE_PATH } from './paths.mjs';
import { SITE } from './site.mjs';

const TIMEOUT_MS = 12000;

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}
function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}

async function probe(path, { expect, minBytes = 1 } = {}) {
  const url = `${SITE}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'valleycity-seo-checks/1.0' } });
    const ms = Date.now() - started;
    if (res.status !== 200) return { status: 'fail', detail: `HTTP ${res.status} (${ms}ms)`, url, http: res.status, ms };
    const body = (await res.text()).trim();
    if (body.length < minBytes) return { status: 'fail', detail: `HTTP 200 tapi kosong/pendek (${body.length} B)`, url, http: 200, bytes: body.length, ms };
    if (expect && !expect.test(body)) return { status: 'fail', detail: `HTTP 200 tapi isi tidak sesuai (harus ada ${expect})`, url, http: 200, bytes: body.length, ms };
    return { status: 'ok', detail: `HTTP 200 · ${(body.length / 1024).toFixed(1)} KB · ${ms}ms`, url, http: 200, bytes: body.length, ms };
  } catch (e) {
    return { status: 'fail', detail: `tidak bisa diakses: ${String(e.message).slice(0, 90)}`, url, ms: Date.now() - started };
  }
}

async function main() {
  const state = loadState();
  if (!state) { console.log('[checks] state.json belum ada — lewat.'); return 0; }
  const now = new Date().toISOString();

  const defs = [
    ['robots', '/robots.txt', { expect: /User-agent/i }],
    ['sitemap', '/sitemap-index.xml', { expect: /<(urlset|sitemapindex)/i, minBytes: 100 }],
    ['llms', '/llms.txt', { expect: /valleycity/i }],
    ['indexnow', '/indexnow.txt', { expect: /^[0-9a-f-]{16,}$/i, minBytes: 8 }],
    ['beranda', '/', { expect: /<html/i }],
  ];

  const checks = {};
  for (const [key, path, opts] of defs) {
    const r = await probe(path, opts);
    checks[key] = { ...r, checkedAt: now };
    console.log(`[checks] ${key}: ${r.status} — ${r.detail}`);
  }
  const ok = Object.values(checks).filter((c) => c.status === 'ok').length;
  checks._meta = { checkedAt: now, ok, total: defs.length, overall: ok === defs.length ? 'ok' : ok >= defs.length - 1 ? 'warn' : 'fail' };

  state.checks = checks;
  saveState(state);
  console.log(`[checks] ${ok}/${defs.length} lolos — ditulis ke state.checks`);
  return 0;
}

main().then((c) => process.exitCode = c).catch((e) => { console.error(`FATAL: ${e.message}`); process.exitCode = 1; });
