/**
 * dashboard/lib/ui.mjs — HTMLstatik + CSS untuk dashboard valleyvity.
 *
 * Tidak ada JavaScript di sisi klien, sama sekali. Semua angka sudah dihitung
 * saat build, jadi tidak ada satu pun endpoint yang bisa membaca data dari
 * browser — dan tidak ada satu pun alasan bagi orang untuk membuka DevTools.
 * Font pun tidak diunduh: ini layar tabel, bukan halaman penjualan.
 *
 * Palet diambil ulang dari token situs (ink/accent) supaya dashboard terasa
 * seperti bagian dari rumah yang sama, tapi tipografinya sistem: 13px, rapat,
 * hairline. Aturan F9 berlaku di sini juga — padat, tanpa scroll panjang.
 */

export function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function num(v) {
  return v === null || v === undefined ? '—' : Number(v).toLocaleString('id-ID');
}

export function pct(v, digits = 1) {
  return v === null || v === undefined ? 'belum diukur' : `${(v * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "12 Apr 2026" dari ISO/date string; null → pemisah em. */
export function date(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return esc(String(s).slice(0, 10));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Umur relatif untuk baris "terakhir": 3 j lalu / 2 hr lalu. */
export function ago(s) {
  if (!s) return 'belum pernah';
  const t = Date.parse(s);
  if (Number.isNaN(t)) return esc(String(s));
  const mins = Math.round((Date.now() - t) / 6e4);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} jam lalu`;
  const days = Math.round(hrs / 24);
  return `${days} hari lalu`;
}

export const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/queue/', label: 'Antrean' },
  { href: '/urls/', label: 'URL' },
  { href: '/content/', label: 'Konten' },
  { href: '/runs/', label: 'Runs' },
  { href: '/health/', label: 'Health' },
];

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --paper:#f7f6f2;--surface:#fff;--ink:#16211f;--ink-2:#3a4a47;--ink-3:#74817e;--ink-4:#9aa5a3;
  --line:rgba(22,33,31,.14);--line-2:rgba(22,33,31,.26);
  --ok:#1c7c54;--warn:#9a6b00;--bad:#a52020;--info:#1c5aa8;
  --accent:#fee203;
}
@media (prefers-color-scheme:dark){
  :root{--paper:#111615;--surface:#171e1d;--ink:#eef1f0;--ink-2:#c3ccca;--ink-3:#8e9a97;--ink-4:#6f7a78;
    --line:rgba(238,241,240,.16);--line-2:rgba(238,241,240,.3);
    --ok:#5ad39f;--warn:#e8bf4a;--bad:#ff8f8f;--info:#8ab6ff}
}
html{font-size:13px}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-variant-numeric:tabular-nums;line-height:1.45;-webkit-text-size-adjust:100%}
a{color:inherit}
header.top{border-bottom:1px solid var(--line-2);background:var(--surface)}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px}
.brandrow{display:flex;align-items:baseline;gap:10px;padding:12px 0 8px;flex-wrap:wrap}
.brandrow h1{font-size:15px;margin:0;letter-spacing:.01em}
.brandrow .host{color:var(--ink-3);font-size:12px}
.brandrow .when{margin-left:auto;color:var(--ink-4);font-size:11.5px}
nav{display:flex;gap:2px;flex-wrap:wrap;padding-bottom:10px}
nav a{text-decoration:none;font-size:12.5px;padding:5px 10px;border:1px solid transparent;border-radius:999px;color:var(--ink-2)}
nav a:hover{border-color:var(--line-2)}
nav a[aria-current=page]{background:var(--ink);color:var(--accent);border-color:var(--ink)}
main{padding:16px 0 40px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);margin:22px 0 8px;font-weight:600}
h2:first-child{margin-top:0}
.grid{display:grid;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.g2{grid-template-columns:repeat(2,minmax(0,1fr))}
@media (max-width:860px){.g4,.g3,.g2{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:520px){.g4,.g3,.g2{grid-template-columns:1fr}}
.cell{background:var(--surface);padding:10px 12px;min-width:0}
.kpi .v{font-size:22px;line-height:1.1;font-weight:650}
.kpi .l{color:var(--ink-3);font-size:11.5px;text-transform:uppercase;letter-spacing:.06em}
.kpi .n{color:var(--ink-4);font-size:11.5px;margin-top:3px}
table{width:100%;border-collapse:collapse;background:var(--surface);font-size:12.5px}
table.bordered{border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:7px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);font-weight:600;background:color-mix(in srgb,var(--ink) 4%,var(--surface))}
tbody tr:last-child td{border-bottom:0}
td.r,th.r{text-align:right}
td.mono,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--ink-2);word-break:break-all}
.chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--line-2);color:var(--ink-2);white-space:nowrap}
.chip.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent)}
.chip.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent)}
.chip.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 45%,transparent)}
.chip.info{color:var(--info);border-color:color-mix(in srgb,var(--info) 45%,transparent)}
.note{color:var(--ink-3);font-size:12px;margin:6px 0 0}
.callout{border-left:3px solid var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--surface));padding:9px 12px;border-radius:0 8px 8px 0;margin:10px 0;font-size:12.5px}
.callout.bad{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,var(--surface))}
.callout.ok{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,var(--surface))}
.callout.info{border-color:var(--info);background:color-mix(in srgb,var(--info) 8%,var(--surface))}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--line);margin:8px 0 4px}
.bar i{display:block;min-width:2px}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-3)}
.legend b{font-weight:600;color:var(--ink-2)}
.sw{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:1px}
.scroll{overflow-x:auto}
footer{border-top:1px solid var(--line);color:var(--ink-4);font-size:11.5px;padding:14px 0 30px}
details{margin:8px 0}
details>summary{cursor:pointer;font-size:12px;color:var(--ink-2);padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);list-style:none}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"+  ";color:var(--ink-3)}
details[open]>summary::before{content:"-  "}
details[open]>summary{border-radius:8px 8px 0 0;border-bottom:0}
details>.inner{border:1px solid var(--line);border-radius:0 0 8px 8px;padding:8px;background:var(--surface)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:color-mix(in srgb,var(--ink) 6%,transparent);padding:1px 4px;border-radius:4px}
@media print{nav,footer{display:none}body{background:#fff}}
`;

const CHIP = {
  ok: 'ok', published: 'ok', indexed: 'ok', keep: 'ok', true: 'ok',
  warn: 'warn', review: 'warn', pending: 'warn', draft: 'warn',
  bad: 'bad', fail: 'bad', blocked: 'bad', not_indexed: 'bad', halt: 'bad', redirect: 'bad',
  info: 'info', unknown: 'info', not_discovered: 'info', skip: 'info', skipped: 'info', closed: 'bad', open: 'ok',
};

export function chip(value, label) {
  const v = String(value);
  const kind = CHIP[v.toLowerCase()] || '';
  return `<span class="chip ${kind}">${esc(label ?? v)}</span>`;
}

/**
 * Bagian yang terlipat tanpa JavaScript. Dipakai untuk daftar panjang yang
 * isinya seragam — 54 baris "belum diukur" bukan informasi per baris, dan
 * membentangkannya di layar 390 px hanya memaksa orang menggulir.
 */
export function fold(summary, inner, { open = false } = {}) {
  return `<details${open ? ' open' : ''}><summary>${summary}</summary><div class="inner">${inner}</div></details>`;
}

export function table(cols, rows, { empty = 'Tidak ada baris.', bordered = true } = {}) {
  // `empty` ditulis tangan oleh halaman dan boleh mengandung <code> — jangan
  // di-escape, kalau tidak pesannya tampil sebagai &lt;code&gt; di layar.
  if (!rows.length) return `<p class="note">${empty}</p>`;
  const head = cols
    .map((c) => `<th class="${c.align === 'r' ? 'r' : ''}">${esc(typeof c === 'string' ? c : c.label)}</th>`)
    .join('');
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td class="${c.align === 'r' ? 'r' : ''}${c.mono ? ' mono' : ''}">${c.get(r)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="scroll"><table class="${bordered ? 'bordered' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** KPI kotak. `note` wajib kalau angka bisa disalahpahami (mis. belum diukur). */
export function kpi(label, value, note = '') {
  return `<div class="cell kpi"><div class="l">${esc(label)}</div><div class="v">${value}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
}

/** Bar bertumpuk dari [[nilai, warna, label]] — SVG-free, 4 div. */
export function stackedBar(parts) {
  const total = parts.reduce((a, [, , v]) => a + v, 0);
  if (!total) return '';
  const bars = parts
    .filter(([, , v]) => v > 0)
    .map(([label, color, v]) => `<i title="${esc(label)}: ${v}" style="width:${(v / total) * 100}%;background:${color}"></i>`)
    .join('');
  const legend = parts
    .filter(([, , v]) => v > 0)
    .map(([label, color, v]) => `<span><span class="sw" style="background:${color}"></span><b>${esc(label)}</b> ${num(v)}</span>`)
    .join('');
  return `<div class="bar">${bars}</div><div class="legend">${legend}</div>`;
}

/**
 * Sparkline dari seri tanggal-terikat. Nilai null TIDAK digambar sebagai 0 —
 * titik diskip, dan kalau semuanya null pemanggil harus menulis alasannya.
 */
export function spark(points, { w = 260, h = 40 } = {}) {
  const vals = points.filter((p) => p.value !== null && p.value !== undefined);
  if (vals.length < 2) return '';
  const max = Math.max(...vals.map((p) => p.value), 1);
  const step = w / (points.length - 1);
  const xy = points.map((p, i) => (p.value === null || p.value === undefined ? null : [i * step, h - (p.value / max) * (h - 6) - 3]));
  const ok = xy.filter(Boolean);
  const d = ok.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dots = ok.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="currentColor"></circle>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="tren"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"></path>${dots}</svg>`;
}

export function layout({ title, path, body, generatedAt, brand, site, access }) {
  const nav = NAV.map((n) => `<a href="${n.href}"${n.href === path ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  const accessLine = access
    ? `${chip(access.mode === 'enforced' ? 'ok' : access.mode === 'enforce-off' ? 'warn' : 'bad', access.mode === 'enforced' ? 'Access: enforce ON' : access.mode === 'enforce-off' ? 'Access: enforce OFF' : 'Access: belum ada')} ${esc(access.note)}`
    : '<span style="color:var(--bad)">Status proteksi tidak dinyatakan saat build — anggap halaman ini terbuka.</span>';
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ${esc(brand)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="brandrow">
    <h1>${esc(brand)} · SEO</h1>
    <span class="host mono">${esc(site)}</span>
    <span class="when">dibangun ${esc(ago(generatedAt))} · ${esc(date(generatedAt))}</span>
  </div>
  <nav>${nav}</nav>
</div></header>
<main><div class="wrap">${body}</div></main>
<footer><div class="wrap">
  ${accessLine}<br>
  Statis, tanpa JavaScript. Angka berasal dari <code>seo/</code> di repo pada saat build — bukan waktu nyata.
</div></footer>
</body>
</html>
`;
}
