// web/src/lib/format.js — format angka/tanggal jujur (null ≠ 0).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('id-ID'));
export const pct = (v, d = 1) => (v === null || v === undefined ? 'belum diukur' : `${(v * 100).toFixed(d)}%`);

export function date(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function ago(s) {
  if (!s) return 'belum pernah';
  const t = Date.parse(s);
  if (Number.isNaN(t)) return String(s);
  const mins = Math.round((Date.now() - t) / 6e4);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} jam lalu`;
  return `${Math.round(hrs / 24)} hari lalu`;
}

const CHIP = {
  ok: 'ok', published: 'ok', indexed: 'ok', keep: 'ok', true: 'ok', open: 'ok', approved: 'ok',
  warn: 'warn', review: 'warn', pending: 'warn', draft: 'warn', suggested: 'warn',
  bad: 'bad', fail: 'bad', blocked: 'bad', not_indexed: 'bad', halt: 'bad', redirect: 'bad', closed: 'bad', error: 'bad',
  info: 'info', unknown: 'info', not_discovered: 'info', skip: 'info', skipped: 'info', running: 'info',
};
export const chipKind = (v) => CHIP[String(v).toLowerCase()] || '';
export const shortUrl = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '') || '/';
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));