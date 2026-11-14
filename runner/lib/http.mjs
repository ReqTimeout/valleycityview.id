/**
 * runner/lib/http.mjs — server dashboard Valley City SEO (node:http, zero-dep).
 *
 * Pola sbdental: HTML dirakit per-request, bukan build statis. Situs publik
 * tetap Astro di Cloudflare Pages; server ini HIDUP di container runner
 * (Coolify), tidak pernah ikut build site/. Karena itu:
 *  - setiap respons noindex + no-referrer + nosniff + DENY frame;
 *  - /healthz terbuka (probe Coolify), sisanya di balik sesi HMAC bila auth on;
 *  - mutasi = spawn CLI engine yang SAMA (gerbang fail-closed tidak dilewati),
 *    fire-and-forget lalu redirect ke /runs — progres dibaca dari runs.json.
 *
 * Tidak ada framework, tidak ada npm runtime dependency. Node >= 23.6.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ROOT, CONFIG_PATH } from '../../seo/paths.mjs';
import { CFG, hasAuth, publishScript } from './config.mjs';
import { logAudit } from './audit.mjs';
import { COOKIE_NAME, sign, verify, parseCookies, sessionCookie, clearCookie, checkCredentials } from './session.mjs';
import { renderPage, pageList } from '../../seo/dashboard.mjs';
import { renderLogin } from '../../seo/login.mjs';

const ASSETS_DIR = join(ROOT, 'runner/assets');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PAGES = new Set(pageList());
const STARTED = Date.now();

// ── util respons ───────────────────────────────────────────────────────────
function secure(res, extra = {}) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}
function send(res, code, body, type = 'text/html; charset=utf-8', extra = {}) {
  secure(res, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.writeHead(code);
  res.end(body);
}
function redirect(res, location, { code = 302, cookie = null } = {}) {
  secure(res, { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) });
  res.writeHead(code);
  res.end();
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('body terlalu besar')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
const sessionOf = (req) => (hasAuth() ? verify(parseCookies(req.headers.cookie)[COOKIE_NAME]) : { u: 'tamu' });

function dailyCount() {
  try { return Number(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).daily_count ?? 1); }
  catch { return 1; }
}

// ── mutasi: spawn CLI engine (gerbang tetap di CLI) ────────────────────────
const lastTrigger = {};
const ACTIONS = {
  '/api/run-daily': { script: 'runner/daily.mjs', args: () => [], to: '/runs', msg: 'Pipeline harian dimulai — pantau tahapnya di Runs.' },
  '/api/generate': { script: 'seo/generate.mjs', args: () => [`--count=${Math.min(CFG.generateCount, CFG.generateCountMax)}`], to: '/runs', msg: 'Generate draft dimulai — gerbang keyword tetap berlaku.' },
  '/api/publish': { script: publishScript, args: () => [`--count=${dailyCount()}`], to: '/runs', msg: `Publish dimulai (kuota ${dailyCount()}/hari dari config).` },
  '/api/inspect': { script: 'seo/gsc-inspect.mjs', args: () => ['--all'], to: '/indexasi', msg: 'Inspeksi GSC dimulai — butuh kredensial GSC terpasang.' },
};

function trigger(action, user) {
  const a = ACTIONS[action];
  const now = Date.now();
  if (lastTrigger[action] && now - lastTrigger[action] < 5000) {
    return { ok: false, msg: 'Baru saja dipicu — tunggu beberapa detik.' };
  }
  lastTrigger[action] = now;
  const args = a.args();
  const child = spawn(process.execPath, [join(ROOT, a.script), ...args], {
    cwd: ROOT, stdio: 'ignore', detached: true, env: process.env,
  });
  child.on('error', (e) => console.error(`[http] spawn ${a.script} gagal: ${e.message}`));
  child.unref();
  logAudit({ user: user || 'tamu', action, script: a.script, args, pid: child.pid });
  console.log(`[http] trigger ${a.script} ${args.join(' ')} (pid ${child.pid}) oleh ${user || 'tamu'}`);
  return { ok: true, msg: a.msg, to: a.to };
}

// ── assets statis (publik: css/js/svg tanpa data) ──────────────────────────
function serveAsset(res, name) {
  if (!/^[a-z0-9._-]+$/i.test(name)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const file = join(ASSETS_DIR, name);
  if (!file.startsWith(ASSETS_DIR) || !existsSync(file)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const type = MIME[extname(name)] || 'application/octet-stream';
  secure(res, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
  res.writeHead(200);
  res.end(readFileSync(file));
}

function notFound(res) {
  send(res, 404, `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>404</title><link rel="stylesheet" href="/assets/dashboard.css"></head><body><div class="auth-shell"><div class="auth-backdrop"></div><div class="auth-inner" style="text-align:center;color:var(--forest-ink)"><h1 style="font-size:40px;margin:0">404</h1><p>Halaman tidak ada.</p><a class="btn gold" href="/">Kembali ke Overview</a></div></div></body></html>`);
}

// ── handler ────────────────────────────────────────────────────────────────
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method || 'GET';

  try {
    // Probe & robots: terbuka, tanpa auth.
    if (path === '/healthz') {
      return send(res, 200, JSON.stringify({ ok: true, service: 'valleycity-seo-dashboard', uptimeSec: Math.round((Date.now() - STARTED) / 1000), pid: process.pid, auth: hasAuth() }), 'application/json; charset=utf-8');
    }
    if (path === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    if (path === '/favicon.ico') { secure(res); res.writeHead(204); return res.end(); }
    if (path.startsWith('/assets/')) return serveAsset(res, path.slice('/assets/'.length));

    // Login / logout.
    if (path === '/login') {
      if (method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        const user = form.get('username') || '';
        const pass = form.get('password') || '';
        if (checkCredentials(user, pass)) {
          return redirect(res, '/', { code: 303, cookie: sessionCookie(sign(user || 'admin')) });
        }
        return send(res, 401, renderLogin({ error: 'Username atau password salah.' }));
      }
      if (hasAuth() && sessionOf(req)) return redirect(res, '/');
      return send(res, 200, renderLogin({ error: null }));
    }
    if (path === '/logout' && method === 'POST') {
      return redirect(res, hasAuth() ? '/login' : '/', { code: 303, cookie: clearCookie() });
    }

    // Mutasi API.
    if (method === 'POST' && ACTIONS[path]) {
      if (hasAuth() && !sessionOf(req)) return redirect(res, '/login', { code: 303 });
      const r = trigger(path, sessionOf(req)?.u);
      const to = (r.to || '/runs') + '?msg=' + encodeURIComponent(r.msg);
      return redirect(res, to, { code: 303 });
    }

    // Halaman dashboard.
    if (method === 'GET') {
      if (hasAuth() && !sessionOf(req)) return redirect(res, '/login');
      const key = path === '/index.html' ? '/' : path.replace(/\/$/, '') || '/';
      if (!PAGES.has(key)) return notFound(res);
      const sess = sessionOf(req);
      let html;
      try {
        html = renderPage(key, { user: sess?.u || null });
      } catch (e) {
        console.error(`[http] render ${key} gagal: ${e.message}`);
        return send(res, 500, `<!doctype html><meta name="robots" content="noindex"><link rel="stylesheet" href="/assets/dashboard.css"><div class="auth-shell"><div class="auth-backdrop"></div><div class="auth-inner"><div class="auth-card"><h1 style="margin-top:0">Gagal merakit halaman</h1><p class="note">Mesin tidak bisa membaca keadaan saat ini. Cek <a href="/health">Health</a> atau log container. Pesan: ${String(e.message).replace(/[<>&]/g, '')}</p><a class="btn ghost" href="/">Coba lagi</a></div></div></div>`);
      }
      return send(res, 200, html);
    }

    return notFound(res);
  } catch (e) {
    console.error(`[http] ${method} ${path} error: ${e.message}`);
    if (!res.headersSent) send(res, 500, 'Internal error', 'text/plain; charset=utf-8');
    else res.end();
  }
}

export function startServer({ port = CFG.port } = {}) {
  const server = http.createServer(handler);
  server.on('error', (e) => console.error(`[http] server error: ${e.message}`));
  server.listen(port, () => {
    console.log(`[http] dashboard Valley City SEO di port ${port} · auth ${hasAuth() ? 'ON' : 'OFF (noindex saja)'} · ${PAGES.size} halaman`);
  });
  return server;
}

// Jalan langsung: node runner/lib/http.mjs (untuk uji lokal).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
