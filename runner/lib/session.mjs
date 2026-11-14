/**
 * runner/lib/session.mjs — cookie sesi dashboard (HMAC, tanpa dependency).
 *
 * Format token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Payload: { u: username, exp: epochSeconds }. TTL 7 hari.
 * Rahasia: env SESSION_SECRET; kalau kosong diturunkan dari DASHBOARD_PASS.
 * Perbandingan timing-safe (kredensial + MAC). Auth mati bila user/pass kosong.
 */
import crypto from 'node:crypto';
import { CFG } from './config.mjs';

export const COOKIE_NAME = 'vcvsid';
const MAX_AGE_SEC = 7 * 24 * 3600;

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return 'valleycity-dashboard|' + (CFG.authPass || 'no-auth');
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function sign(username) {
  const payload = { u: username, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC };
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}

export function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx < 1) return null;
  const body = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(token) {
  const attrs = [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + MAX_AGE_SEC,
  ];
  if (process.env.COOKIE_SECURE !== 'false') attrs.push('Secure');
  return attrs.join('; ');
}

export function clearCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function checkCredentials(user, pass) {
  if (!CFG.authUser || !CFG.authPass) return true; // auth dimatikan → terbuka (tetap noindex)
  const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    if (ba.length !== bb.length) {
      crypto.timingSafeEqual(ba, ba);
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  };
  return safeEqual(user, CFG.authUser) && safeEqual(pass, CFG.authPass);
}
