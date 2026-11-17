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

// Palet status — dibaca sekilas: hijau = bagus, kuning = perlu perhatian,
// merah = gagal/kritis, biru = info netral. Sebelumnya status cuma teks polos
// di blok monospace sehingga "apa yang bagus dan apa yang tidak" tidak terbaca.
const STATUS = {
  ok:   { badge: '#16a34a', label: 'BAIK',       light: '#dcfce7', text: '#166534' },
  warn: { badge: '#d97706', label: 'PERHATIAN',  light: '#fef3c7', text: '#92400e' },
  fail: { badge: '#dc2626', label: 'GAGAL',      light: '#fee2e2', text: '#991b1b' },
  info: { badge: '#2563eb', label: 'INFO',       light: '#dbeafe', text: '#1e40af' },
};
const st = (k) => STATUS[k] || STATUS.info;

function badgeHtml(status) {
  const c = st(status);
  return `<span style="display:inline-block;background:${c.badge};color:#fff;font-size:10.5px;` +
    `font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:999px;white-space:nowrap">${c.label}</span>`;
}

/** Satu baris item berstatus: badge + label + detail (tabel agar rapi di Gmail). */
function itemHtml(it) {
  const c = st(it.status);
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr>' +
    `<td width="86" valign="top" style="padding:2px 8px 2px 0">${badgeHtml(it.status)}</td>` +
    '<td valign="top" style="font-size:14px;color:#0f172a;line-height:1.45">' +
    `<span style="font-weight:600">${escapeHtml(it.label || '')}</span>` +
    (it.detail ? `<div style="font-size:12.5px;color:${c.text};margin-top:1px">${escapeHtml(it.detail)}</div>` : '') +
    '</td></tr></table>'
  );
}

/** Kartu angka besar (KPI) — 2 kolom, aman di layar sempit. */
function statsHtml(stats) {
  if (!stats || !stats.length) return '';
  const cell = (x) =>
    '<td width="50%" valign="top" style="padding:4px">' +
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px">' +
    `<div style="font-size:26px;font-weight:800;color:#0f172a;line-height:1.1">${escapeHtml(x.value)}</div>` +
    `<div style="font-size:11.5px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-top:4px">${escapeHtml(x.label)}</div>` +
    (x.sub ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:2px">${escapeHtml(x.sub)}</div>` : '') +
    '</div></td>';
  let rows = '';
  for (let i = 0; i < stats.length; i += 2) {
    rows += '<tr>' + cell(stats[i]) + (stats[i + 1] ? cell(stats[i + 1]) : '<td width="50%"></td>') + '</tr>';
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${rows}</table>`;
}

function sectionTitleHtml(title, tone) {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${tone};` +
    `border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin:18px 0 10px">${escapeHtml(title)}</div>`;
}

/** Body teks lama → paragraf terbaca (bukan <pre> monospace). */
function bodyHtml(body) {
  const lines = String(body || '').split('\n');
  const out = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<div style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 4px">${escapeHtml(l)}</div>`)
    .join('');
  return out || '<div style="font-size:13px;color:#94a3b8">—</div>';
}

/**
 * Bentuk HTML laporan yang terbaca sekilas.
 * @param {{title?:string, eyebrow?:string, date?:string, tone?:'alert'|'info',
 *          stats?:{label:string,value:string|number,sub?:string}[],
 *          sections?:{title:string,body?:string,items?:{label:string,status:string,detail?:string}[],note?:string}[]}} opt
 */
export function buildHtml(opt) {
  const tone = opt.tone === 'alert' ? '#b91c1c' : '#4f46e5';
  const sections = (opt.sections || []).map((s) => {
    let inner = '';
    if (Array.isArray(s.items) && s.items.length) inner += s.items.map(itemHtml).join('');
    if (s.body) inner += bodyHtml(s.body);
    if (s.note) inner += `<div style="font-size:12.5px;color:#64748b;font-style:italic;margin-top:6px">${escapeHtml(s.note)}</div>`;
    return sectionTitleHtml(s.title, tone) + inner;
  }).join('');

  return (
    '<div style="background:#f1f5f9;padding:20px 12px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="color:#0f172a;line-height:1.55;max-width:640px;margin:0 auto">' +
    `<div style="background:${tone};color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${escapeHtml(opt.eyebrow || EYEBROW)}</div>` +
    `<div style="font-size:20px;font-weight:800;margin-top:5px">${escapeHtml(opt.title || '')}</div>` +
    (opt.date ? `<div style="font-size:13px;opacity:.9;margin-top:3px">${escapeHtml(opt.date)}</div>` : '') +
    '</div>' +
    '<div style="border:1px solid #e2e8f0;border-top:0;padding:20px 24px;border-radius:0 0 12px 12px;background:#fff">' +
    statsHtml(opt.stats) + sections +
    `<div style="margin-top:20px;padding-top:14px;border-top:1px solid #e2e8f0">` +
    `<a href="${DASHBOARD_URL}" style="display:inline-block;background:${tone};color:#fff;font-size:13.5px;font-weight:700;` +
    `text-decoration:none;padding:9px 16px;border-radius:8px">Buka dashboard SEO</a>` +
    `<div style="font-size:11.5px;color:#94a3b8;margin-top:10px">Dikirim otomatis oleh SEO engine valleycityview.id · ` +
    `hijau = berjalan baik · kuning = perlu perhatian · merah = gagal.</div>` +
    '</div></div></div></div>'
  );
}

/** Versi teks polos — tetap terbaca tanpa HTML, status ditulis eksplisit. */
function buildText(msg, sections, stats) {
  const out = [msg.title || msg.subject || '', '='.repeat(56), ''];
  if (stats && stats.length) {
    for (const x of stats) out.push(`${x.label}: ${x.value}${x.sub ? ' (' + x.sub + ')' : ''}`);
    out.push('');
  }
  for (const s of sections) {
    out.push(s.title.toUpperCase(), '-'.repeat(56));
    if (Array.isArray(s.items)) for (const it of s.items) out.push(`[${st(it.status).label}] ${it.label}${it.detail ? ' — ' + it.detail : ''}`);
    if (s.body) out.push(s.body);
    if (s.note) out.push(`(${s.note})`);
    out.push('');
  }
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
  const html = buildHtml({ title: msg.title || msg.heading || msg.subject, date: msg.date, sections, stats: msg.stats, tone: msg.tone });
  const text = buildText(msg, sections, msg.stats);

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
