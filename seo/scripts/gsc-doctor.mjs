#!/usr/bin/env node
/**
 * gsc-doctor — health check kredensial + API untuk SEO runner valleycity.id.
 * Runbook: seo/README.md §10
 *
 * ZERO DEPENDENCY (node:crypto + global fetch, butuh Node >= 20)
 * Supaya tidak perlu `googleapis` di image runner.
 *
 * Env (urutan prioritas):
 *   GSC_SERVICE_ACCOUNT_JSON_B64  base64 JSON SA (Coolify/prod)
 *   GSC_SERVICE_ACCOUNT_JSON      raw JSON SA dengan \n escaped (back-compat)
 *   GSC_SA_FILE                   path ke file JSON (dev lokal)
 *   GSC_SITE_URL                  default sc-domain:valleycity.id
 *   GSC_INDEXING_PROBE            set "0" untuk skip probe Indexing API
 *
 * Usage:
 *   GSC_SA_FILE=/path/sa.json node seo/scripts/gsc-doctor.mjs
 *   node seo/scripts/gsc-doctor.mjs https://valleycity.id/artikel-tua
 *   node seo/scripts/gsc-doctor.mjs --auth-only     # creds + token + sites saja (preflight runner)
 */

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const SITE = process.env.GSC_SITE_URL || 'sc-domain:valleycity.id';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/indexing',
].join(' ');

const results = [];
const ok = (name, detail = '') => results.push({ pass: true, name, detail });
const bad = (name, detail = '') => results.push({ pass: false, name, detail });
const skip = (name, detail = '') => results.push({ pass: null, name, detail });

function loadCreds() {
  if (process.env.GSC_SA_FILE) {
    return JSON.parse(readFileSync(process.env.GSC_SA_FILE, 'utf8'));
  }
  if (process.env.GSC_SERVICE_ACCOUNT_JSON_B64) {
    return JSON.parse(Buffer.from(process.env.GSC_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8'));
  }
  if (process.env.GSC_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON.replace(/\\n/g, '\n'));
  }
  throw new Error('No credentials: set GSC_SA_FILE (dev) atau GSC_SERVICE_ACCOUNT_JSON_B64 (prod)');
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function getToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(creds.private_key, 'base64url')}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`token exchange HTTP ${res.status}: ${data.error_description || data.error}`);
  return data.access_token;
}

async function api(token, url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const iso = (d) => d.toISOString().slice(0, 10);

async function main() {
  const argv = process.argv.slice(2);
  const authOnly = argv.includes('--auth-only');
  const targetUrl = argv.find((a) => a.startsWith('http')) || 'https://valleycity.id/';

  let creds;
  try {
    creds = loadCreds();
    ok('creds loaded', creds.client_email);
  } catch (e) {
    bad('creds loaded', e.message);
    return report();
  }

  let token;
  try {
    token = await getToken(creds);
    ok('token exchange', `private key valid, SA aktif (project ${creds.project_id})`);
  } catch (e) {
    bad('token exchange', e.message);
    return report();
  }

  const sites = await api(token, 'https://www.googleapis.com/webmasters/v3/sites');
  if (sites.status === 200) {
    const list = (sites.json.siteEntry || []).map((s) => s.siteUrl);
    list.includes(SITE)
      ? ok('GSC sites.list', `SA punya akses: ${list.join(', ')}`)
      : bad('GSC sites.list', `property "${SITE}" tidak ada di daftar: ${list.join(', ') || '(kosong)'}`);
  } else {
    bad('GSC sites.list', `HTTP ${sites.status} ${JSON.stringify(sites.json).slice(0, 200)}`);
  }

  if (authOnly) {
    console.log('\n(--auth-only: berhenti sebelum URL Inspection / Search Analytics / cek file publik)');
    report();
    return;
  }

  const inspect = await api(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    inspectionUrl: targetUrl,
    siteUrl: SITE,
    languageCode: 'en-US',
  });
  if (inspect.status === 200) {
    const s = inspect.json.inspectionResult?.indexStatusResult || {};
    ok('URL Inspection', `${targetUrl} → ${s.verdict} / ${s.coverageState} / crawl ${s.lastCrawlTime || 'never'}`);
  } else {
    bad('URL Inspection', `HTTP ${inspect.status} ${JSON.stringify(inspect.json).slice(0, 200)}`);
  }

  const end = new Date();
  const start = new Date(end.getTime() - 28 * 86400000);
  const sa = await api(
    token,
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
    { startDate: iso(start), endDate: iso(end), dimensions: ['query'], rowLimit: 5 }
  );
  if (sa.status === 200) {
    const rows = sa.json.rows || [];
    rows.length
      ? ok('Search Analytics 28d', rows.map((r) => `${r.keys[0]} (${r.clicks}c/${r.impressions}i)`).join(' | '))
      : skip('Search Analytics 28d', '0 baris — property masih terlalu baru');
  } else {
    bad('Search Analytics 28d', `HTTP ${sa.status} ${JSON.stringify(sa.json).slice(0, 200)}`);
  }

  if (process.env.GSC_INDEXING_PROBE === '0') {
    skip('Indexing API', 'skip (GSC_INDEXING_PROBE=0)');
  } else {
    const meta = await api(token, 'https://indexing.googleapis.com/v3/urlNotifications/metadata?url=' + encodeURIComponent(targetUrl));
    if (meta.status === 200) {
      ok('Indexing API', `enabled, notif type = ${meta.json.googleUrlNotificationType || 'unknown'}`);
    } else if (meta.status === 400) {
      ok('Indexing API', 'enabled (400 = parameter wajib, artinya API hidup)');
    } else if (meta.status === 404) {
      ok('Indexing API', 'enabled, URL ini belum pernah di-submit (NOT_FOUND)');
    } else {
      skip('Indexing API', `HTTP ${meta.status} ${JSON.stringify(meta.json).slice(0, 160)} — cek enable di console`);
    }
  }

  for (const url of ['https://valleycity.id/indexnow.txt', 'https://valleycity.id/sitemap-index.xml']) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      res.status === 200 ? ok(`public ${new URL(url).pathname}`, `${res.headers.get('content-length') || '?'} bytes`) : bad(`public ${new URL(url).pathname}`, `HTTP ${res.status}`);
    } catch (e) {
      bad(`public ${new URL(url).pathname}`, e.message);
    }
  }

  report();
}

function report() {
  console.log(`\nGSC DOCTOR — site: ${SITE}\n`);
  for (const r of results) {
    const tag = r.pass === null ? 'SKIP' : r.pass ? ' OK ' : 'FAIL';
    console.log(`[${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => r.pass === false);
  console.log(`\n${failed.length ? `✗ ${failed.length} check gagal — lihat seo/README.md §13` : '✓ semua check wajib lolos'}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exitCode = 1;
});
