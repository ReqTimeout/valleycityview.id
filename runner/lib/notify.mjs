/**
 * runner/lib/notify.mjs — kirim laporan/alert via Resend.
 *
 * Desain email diport dari sbdental (runner/lib/report.mjs): kartu header berwarna
 * + seksi uppercase + blok monospace + tautan dashboard. Alasan: laporan klien
 * harus terlihat sama rapihnya di semua proyek agency.
 *
 * Penerima:
 *   NOTIFY_EMAIL_TO   → internal (agency) — SELALU dapat laporan & alert
 *   NOTIFY_EMAIL_CC   → klien — hanya untuk laporan (harian/mingguan); alert
 *                       pipeline TIDAK boleh sampai ke klien (pelajaran sbdental,
 *                       memory/11: alert watchdog menyampah ke klien).
 *   Panggilan laporan menyertakan `cc: notifyCc()`; panggilan alert tidak.
 *
 * Tanpa `RESEND_API_KEY` (belum diisi di Coolify) → hanya log ke stdout, tidak
 * gagal. Dengan key → POST ke Resend REST API (zero dependency, global fetch).
 *
 * Env: RESEND_API_KEY · NOTIFY_EMAIL_TO · NOTIFY_EMAIL_CC · NOTIFY_EMAIL_FROM
 *      SEO_NOTIFY_DRYRUN=1 → jangan kirim sungguhan (untuk uji coba).
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { STATE_PATH } from '../../seo/paths.mjs';

const API = 'https://api.resend.com/emails';
const DASHBOARD_URL = 'https://valleycity.beriklan.co.id';
const EYEBROW = 'valleycityview.id · SEO';

/**
 * Rekam riwayat laporan ke state.reports (state.json → volume container,
 * selamat dari redeploy). Dipakai halaman /laporan. Gagal menulis riwayat
 * TIDAK PERNAH menggagalkan pengiriman — log saja.
 */
function recordReport(entry) {
  try {
    let state = {};
    if (existsSync(STATE_PATH)) {
      try { state = JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch {}
    }
    const list = Array.isArray(state.reports) ? state.reports : [];
    list.unshift(entry);
    state.reports = list.slice(0, 60);
    const tmp = `${STATE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, STATE_PATH);
  } catch (e) {
    console.error(`[notify] rekam riwayat gagal (pengiriman tetap jalan): ${e.message}`);
  }
}

export function notifyConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_TO && process.env.NOTIFY_EMAIL_FROM);
}

export function recipients() {
  return (process.env.NOTIFY_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Penerima laporan tambahan (klien) dari env NOTIFY_EMAIL_CC. */
export function notifyCc() {
  return (process.env.NOTIFY_EMAIL_CC || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Bentuk HTML laporan (port sbdental report.mjs).
 * @param {{title?:string, eyebrow?:string, sections?:{title:string,body:string}[], tone?:'alert'|'info'}} opt
 */
export function buildHtml(opt) {
  const tone = opt.tone === 'alert' ? '#b91c1c' : '#4f46e5';
  const sections = (opt.sections || [])
    .map(
      (s) =>
        '<div style="margin-bottom:20px">' +
        `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${tone};` +
        'border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:8px">' +
        `${escapeHtml(s.title)}</div>` +
        '<pre style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;' +
        'white-space:pre-wrap;color:#334155;background:#f8fafc;padding:12px;border-radius:6px">' +
        `${escapeHtml(s.body)}</pre></div>`
    )
    .join('');
  return (
    '<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'color:#0f172a;line-height:1.55;max-width:640px;margin:0 auto">' +
    `<div style="background:${tone};color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">` +
    `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${escapeHtml(opt.eyebrow || EYEBROW)}</div>` +
    `<div style="font-size:19px;font-weight:700;margin-top:4px">${escapeHtml(opt.title || '')}</div></div>` +
    '<div style="border:1px solid #e2e8f0;border-top:0;padding:20px 22px;border-radius:0 0 10px 10px;background:#fff">' +
    sections +
    `<div style="font-size:13px;margin-top:4px"><a href="${DASHBOARD_URL}" ` +
    `style="color:${tone};font-weight:600;text-decoration:none">Buka dashboard SEO →</a></div>` +
    '</div></div>'
  );
}

/** Versi teks polos (Resend sertakan text+html; klien di klien mail lama). */
function buildText(msg, sections) {
  const out = [msg.title || msg.subject || '', '='.repeat(56), ''];
  for (const s of sections) out.push(s.title, '-'.repeat(56), s.body, '');
  out.push(`Dashboard: ${DASHBOARD_URL}`);
  return out.join('\n');
}

/** Susun daftar seksi dari API lama (heading + lines + alerts) kalau caller belum pakai `sections`. */
function normalizeSections(msg) {
  if (Array.isArray(msg.sections) && msg.sections.length) return msg.sections;
  const sections = [{ title: msg.heading || msg.title || 'Ringkasan', body: (msg.lines || []).join('\n') }];
  if ((msg.alerts || []).length) {
    sections.push({
      title: 'Peringatan',
      body: msg.alerts
        .map((a) => `[${(a.level || 'warn').toUpperCase()}] ${a.msg || a.code || ''}`)
        .join('\n'),
    });
  }
  if (msg.text) sections.push({ title: 'Detail', body: msg.text });
  return sections;
}

/**
 * @param {{subject:string, title?:string, heading?:string, sections?:{title:string,body:string}[],
 *          alerts?:object[], text?:string, kind?:string, to?:string|string[], cc?:string|string[]|false,
 *          tone?:'alert'|'info'}} msg
 * @returns {Promise<{sent:boolean, reason?:string, id?:string}>}
 */
export async function sendReport(msg) {
  const sections = normalizeSections(msg);
  const html = buildHtml({ title: msg.title || msg.heading || msg.subject, sections, tone: msg.tone });
  const text = buildText(msg, sections);

  // Penerima: `msg.to` menimpa default (jarang dipakai); `msg.cc === false`
  // menonaktifkan klien (alert) — selain itu cc hanya ikut bila panggilan
  // eksplisit mengirimkannya (laporan harian/mingguan).
  const to = asList(msg.to).length ? asList(msg.to) : recipients();
  const cc = msg.cc === false ? [] : asList(msg.cc).filter((x) => !to.includes(x));

  if (process.env.SEO_NOTIFY_DRYRUN === '1') {
    console.log('[notify] DRYRUN — tidak mengirim. Subjek:', msg.subject, '| ke:', to.join(','), cc.length ? `cc: ${cc.join(',')}` : '');
    return { sent: false, reason: 'dryrun' };
  }
  if (!notifyConfigured()) {
    console.log('[notify] RESEND_API_KEY / NOTIFY_EMAIL_* belum di-set — hanya log.');
    console.log(`[notify] subjek: ${msg.subject}`);
    for (const s of sections) for (const l of s.body.split('\n')) console.log(`[notify]   ${s.title} | ${l}`);
    recordReport({ at: new Date().toISOString(), kind: msg.kind || null, subject: msg.subject, to, cc, sent: false, reason: 'not-configured' });
    return { sent: false, reason: 'not-configured' };
  }

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_EMAIL_FROM,
      to,
      ...(cc.length ? { cc } : {}),
      subject: msg.subject,
      text,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[notify] Resend HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    recordReport({ at: new Date().toISOString(), kind: msg.kind || null, subject: msg.subject, to, cc, sent: false, reason: `http-${res.status}`, id: data?.id || null });
    return { sent: false, reason: `http-${res.status}`, id: data?.id };
  }
  const who = [to.join(', '), cc.length ? `(cc ${cc.join(', ')})` : ''].filter(Boolean).join(' ');
  console.log(`[notify] terkirim ke ${who} (id ${data?.id})`);
  recordReport({ at: new Date().toISOString(), kind: msg.kind || null, subject: msg.subject, to, cc, sent: true, id: data?.id || null });
  return { sent: true, id: data?.id };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
