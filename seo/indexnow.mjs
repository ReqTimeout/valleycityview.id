#!/usr/bin/env node
/**
 * seo/indexnow.mjs — ping URL baru ke IndexNow (Bing/Yandex/Naver, spec §5).
 *
 * Key: public/indexnow.txt (auto-discover). Env SOCIO_INDEXNOW_KEY override.
 * Batch ≤10 URL/call, endpoint bing + yandex, retry 1x endpoint kedua.
 *
 * Usage:
 *   node seo/indexnow.mjs https://valleycity.id/blog/foo/ https://valleycity.id/blog/bar/
 *   node seo/indexnow.mjs --all-drafts   # tidak — publish.mjs yang panggil
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ROOT, STATE_PATH } from './paths.mjs';
// Key: env dulu, lalu file key di repo landing (monorepo), lalu file opsional yang
// bisa diset ke lokasi lain (image runner tidak punya landing/).
const KEY =
  process.env.SOCIO_INDEXNOW_KEY ||
  (existsSync(`${ROOT}/site/public/indexnow.txt`)
    ? readFileSync(`${ROOT}/site/public/indexnow.txt`, 'utf8').trim()
    : process.env.INDEXNOW_KEY_FILE && existsSync(process.env.INDEXNOW_KEY_FILE)
      ? readFileSync(process.env.INDEXNOW_KEY_FILE, 'utf8').trim()
      : '');

const ENDPOINTS = [
  'https://api.indexnow.org/indexnow', // redistributes ke Bing+Yandex+Seznam
  'https://yandex.com/indexnow',
];

function loadState() {
  if (!existsSync(STATE_PATH)) return { published: [], indexnow: { submitted: [], last: null } };
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

function saveState(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n');
}

async function ping(urls) {
  if (!urls.length) {
    console.log('indexnow: no URLs');
    return { ok: false, results: [] };
  }
  const body = JSON.stringify({
    host: 'valleycity.id',
    key: KEY,
    keyLocation: 'https://valleycity.id/indexnow.txt',
    urlList: urls.slice(0, 10),
  });

  const results = [];
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      // 200 OK | 202 accepted (key belum diverifikasi) | 422 invalid
      const okStatus = res.status === 200 || res.status === 202;
      console.log(`  ${ep} -> ${res.status} ${okStatus ? 'OK' : 'FAIL'}`);
      results.push({ endpoint: ep, status: res.status, ok: okStatus });
      if (okStatus) break; // endpoint pertama sukses = cukup (redistribusi)
    } catch (e) {
      console.log(`  ${ep} -> ERROR ${e.message.slice(0, 100)}`);
      results.push({ endpoint: ep, status: 0, ok: false });
    }
  }
  const anyOk = results.some((r) => r.ok);
  return { ok: anyOk, results };
}

async function main() {
  const urls = process.argv.slice(2).filter((a) => a.startsWith('http'));
  if (!urls.length) {
    console.error('Usage: node seo/indexnow.mjs <url> [<url>...]');
    process.exit(1);
  }

  if (!KEY) {
    console.error('FATAL: IndexNow key tidak ditemukan. Set SOCIO_INDEXNOW_KEY atau INDEXNOW_KEY_FILE.');
    console.error('  Lihat docs/GOOGLE_CLOUD_SETUP.md §3 (key juga ada di https://valleycity.id/indexnow.txt)');
    process.exit(1);
  }

  const state = loadState();
  const fresh = urls.filter((u) => !state.indexnow.submitted.includes(u));
  console.log(`IndexNow: ${fresh.length}/${urls.length} URL baru (key ${KEY.slice(0, 8)}…)`);

  // Semua URL sudah pernah dikirim = no-op yang SUKSES, bukan kegagalan.
  // (Perbaiki 1 Okt 2026: sebelumnya ini exit 1, sehingga seo/remedy.mjs +
  // publish.mjs salah mengira IndexNow gagal padahal tidak ada yang perlu dikirim.)
  if (!fresh.length) {
    console.log('✓ tidak ada URL baru — tidak ada yang perlu dikirim (no-op)');
    return;
  }

  const { ok, results } = await ping(fresh);
  if (ok) {
    state.indexnow.submitted.push(...fresh);
    state.indexnow.last = new Date().toISOString();
    saveState(state);
    console.log(`✓ submitted ${fresh.length} URL, state.json updated`);
  } else {
    console.log('✗ semua endpoint gagal — state tidak diupdate, retry nanti');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
