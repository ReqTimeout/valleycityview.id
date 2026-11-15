/**
 * runner/lib/notify.mjs — kirim ringkasan harian/mingguan via Resend.
 *
 * Tanpa `RESEND_API_KEY` (belum diisi di Coolify) → hanya log ke stdout, tidak
 * gagal. Dengan key → POST ke Resend REST API (zero dependency, global fetch).
 *
 * Env: RESEND_API_KEY · NOTIFY_EMAIL_TO (comma-separated) · NOTIFY_EMAIL_FROM
 *      SEO_NOTIFY_DRYRUN=1 → jangan kirim sungguhan (untuk uji coba).
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { STATE_PATH } from '../../seo/paths.mjs';

const API = 'https://api.resend.com/emails';

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

/**
 * @param {{subject: string, heading: string, lines: string[], alerts?: object[], text?: string}} msg
 * @returns {Promise<{sent: boolean, reason?: string, id?: string}>}
 */
export async function sendReport(msg) {
  const lines = (msg.lines || []).map((l) => `<li>${escapeHtml(String(l))}</li>`).join('');
  const alerts = (msg.alerts || []).map(
    (a) => `<li><strong>${escapeHtml(a.level || 'warn')}</strong>: ${escapeHtml(a.msg || a.code || '')}</li>`
  ).join('');
  const html = `<!doctype html><html><body style="font:14px/1.6 system-ui,sans-serif;color:#111">
<h2 style="margin:0 0 4px">${escapeHtml(msg.heading || msg.subject)}</h2>
<p style="margin:0 0 12px;color:#666">${escapeHtml(msg.subject)}</p>
<ul style="margin:0 0 12px;padding-left:18px">${lines}</ul>
${alerts ? `<h3 style="margin:12px 0 4px;font-size:13px">Alert</h3><ul style="margin:0;padding-left:18px">${alerts}</ul>` : ''}
${msg.text ? `<pre style="white-space:pre-wrap;background:#f6f6f6;padding:10px;border-radius:6px;font-size:12px">${escapeHtml(msg.text)}</pre>` : ''}
<hr style="border:0;border-top:1px solid #eee;margin:16px 0 6px">
<p style="color:#999;font-size:11px">valleycity-seo-runner · ${new Date().toISOString()}</p>
</body></html>`;

  if (process.env.SEO_NOTIFY_DRYRUN === '1') {
    console.log('[notify] DRYRUN — tidak mengirim. Subjek:', msg.subject);
    return { sent: false, reason: 'dryrun' };
  }
  if (!notifyConfigured()) {
    console.log('[notify] RESEND_API_KEY / NOTIFY_EMAIL_* belum di-set — hanya log.');
    console.log(`[notify] subjek: ${msg.subject}`);
    for (const l of msg.lines || []) console.log(`[notify]   - ${l}`);
    recordReport({ at: new Date().toISOString(), kind: msg.kind || null, subject: msg.subject, to: recipients(), sent: false, reason: 'not-configured' });
    return { sent: false, reason: 'not-configured' };
  }

  const to = recipients();
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_EMAIL_FROM,
      to,
      subject: msg.subject,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[notify] Resend HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    recordReport({ at: new Date().toISOString(), kind: msg.kind || null, subject: msg.subject, to, sent: false, reason: `http-${res.status}`, id: data?.id || null });
    return { sent: false, reason: `http-${res.status}`, id: data?.id };
  }
  console.log(`[notify] terkirim ke ${to.join(', ')} (id ${data?.id})`);
  recordReport({ at: new Date().toISOString(), kind: msg.kind || null, subject: msg.subject, to, sent: true, id: data?.id || null });
  return { sent: true, id: data?.id };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
