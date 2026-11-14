/**
 * seo/dashboard.mjs — renderer dashboard Valley City SEO (server, bukan build).
 *
 * Menggantikan generator statis dashboard/build.mjs: HTML dirakit per-request
 * dari collect() yang sama, jadi angka selalu keadaan mesin sekarang, bukan
 * snapshot waktu build. Helper presentasi dipakai ulang dari dashboard/lib/ui.mjs
 * (esc/num/pct/date/ago/chip/table/kpi/stackedBar/spark/fold) — tidak ada rumus
 * yang dihitung dua cara. Shell (sidebar/dock/dark mode) hidup di sini + CSS
 * eksternal runner/assets/dashboard.css.
 *
 * Aturan yang dijaga (sama dengan data.mjs):
 *  - belum diukur ≠ 0; null ditulis "belum diukur".
 *  - tidak ada path mesin absolut yang bocor (collect() sudah me-relatifkan).
 *  - kredensial hanya "ter-set / belum", tidak pernah nilainya.
 *  - gerbang fail-closed tidak punya tombol bypass di UI.
 */
import { collect } from '../dashboard/lib/data.mjs';
import { esc, num, pct, date, ago, chip, fold, table, kpi, stackedBar, spark } from '../dashboard/lib/ui.mjs';
import { icon } from '../runner/lib/icons.mjs';
import { CFG, hasAuth } from '../runner/lib/config.mjs';
import { buildTracking } from './tracking.mjs';
import { readRank } from './rank.mjs';
import { readAudit } from '../runner/lib/audit.mjs';

const COLOR = { ok: '#1c7c54', bad: '#a52020', warn: '#9a6b00', info: '#74817e', accent: '#c9ad00' };

const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="17.5" cy="6" r="2.1"/><path d="M2 20h20"/><path d="M3 20 9.2 8.5l3.3 5.6"/><path d="M10.5 20 15.5 11l6 9"/></svg>';

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('vcv-theme');var d=t?t==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

function hoursAgo(h) {
  if (h === null || h === undefined) return 'waktu tidak diketahui';
  if (h < 1) return 'baru saja';
  if (h < 48) return `${Math.round(h)} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}
const callout = (kind, html) => `<div class="callout ${kind}">${html}</div>`;
const gateChip = (ok, yes = 'terbuka', no = 'tertutup') => chip(ok ? 'ok' : 'bad', ok ? yes : no);

/** Beri entrance stagger pada blok utama tanpa mengubah isi builder. */
function polish(body) {
  let i = 0;
  return body
    .replace(/<h2>/g, '<h2 class="sec">')
    .replace(/<div class="(grid[^"]*|scroll|callout[^"]*)"/g, (m, c) => `<div class="${c} reveal" style="--i:${i++}"`)
    .replace(/<details/g, () => `<details class="reveal" style="--i:${i++}"`);
}

/** Form mutasi (POST, tanpa JS). Gerbang tetap di CLI — UI hanya memicu. */
function actionForm(action, label, iconName, kind = 'gold') {
  return `<form method="POST" action="${action}" style="display:inline"><button class="btn ${kind} sm" type="submit">${icon(iconName, 15)}<span>${esc(label)}</span></button></form>`;
}

// ── Navigasi ───────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  { label: 'Ringkasan', items: [
    { href: '/', label: 'Overview', icon: 'home' },
    { href: '/traffic', label: 'Traffic', icon: 'chart' },
  ] },
  { label: 'Produksi', items: [
    { href: '/queue', label: 'Antrean', icon: 'list' },
    { href: '/content', label: 'Konten', icon: 'file' },
    { href: '/tracking', label: 'Tracking', icon: 'target' },
  ] },
  { label: 'Indeks', items: [
    { href: '/urls', label: 'URL', icon: 'link' },
    { href: '/indexasi', label: 'Indexasi', icon: 'search' },
  ] },
  { label: 'Operasi', items: [
    { href: '/runs', label: 'Runs', icon: 'play' },
    { href: '/health', label: 'Health', icon: 'activity' },
    { href: '/alerts', label: 'Alerts', icon: 'bell' },
  ] },
];
const DOCK = ['/', '/queue', '/content', '/runs', '/health'];
const NAV_FLAT = NAV_GROUPS.flatMap((g) => g.items);

// ── Shell ──────────────────────────────────────────────────────────────────
function shell({ title, sub, path, body, actions, d, user, auth }) {
  const gateOpen = Boolean(d.keywords.approvedAt) && !d.config.halt;
  const navHtml = NAV_GROUPS.map((g) => `
    <div class="nav-group">
      <div class="nav-label">${esc(g.label)}</div>
      ${g.items.map((n) => `<a class="nav-item" href="${n.href}"${n.href === path ? ' aria-current="page"' : ''}>${icon(n.icon, 17)}<span>${esc(n.label)}</span></a>`).join('')}
    </div>`).join('');

  const dockHtml = DOCK.map((href) => {
    const n = NAV_FLAT.find((x) => x.href === href);
    return `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${icon(n.icon, 19)}<span>${esc(n.label)}</span></a>`;
  }).join('');

  const userChip = auth ? esc(user || 'admin') : 'tanpa login';
  const logout = auth ? `<form method="POST" action="/logout" style="display:inline"><button class="icon-btn" type="submit" aria-label="Keluar" title="Keluar">${icon('logout', 16)}</button></form>` : '';

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(title)} · Valley City SEO</title>
<link rel="icon" href="/assets/brand.svg">
<link rel="stylesheet" href="/assets/dashboard.css">
<script>${THEME_SCRIPT}</script>
</head>
<body>
<div class="scrim" data-drawer-close></div>
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">${MARK}</span>
      <div>
        <div class="brand-title">Valley City<span class="accent"> · SEO</span></div>
        <div class="brand-sub mono">${esc(d.site.replace(/^https?:\/\//, ''))}</div>
      </div>
    </div>
    ${navHtml}
    <div class="side-foot">
      <div class="status-dot${gateOpen ? '' : ' closed'}"><span class="dot"></span><span>Gerbang ${gateOpen ? 'terbuka' : 'tertutup'}</span></div>
      <div class="side-meta">diperbarui ${esc(ago(d.generatedAt))}</div>
      <div class="side-actions">
        <span class="user-chip" title="${esc(userChip)}">${icon('lock', 14)} ${userChip}</span>
        <button class="icon-btn" type="button" data-theme-toggle aria-label="Ganti tema"></button>
        ${logout}
      </div>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <button class="icon-btn" type="button" data-drawer-open aria-label="Buka menu">${icon('menu', 18)}</button>
      <span class="brand-title">Valley City<span class="accent"> · SEO</span></span>
      <span class="spacer"></span>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="Ganti tema"></button>
    </header>
    <main class="content">
      <div class="page-head">
        <div>
          <h1>${esc(title)}</h1>
          ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
        </div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>
      ${body}
    </main>
  </div>
</div>
<nav class="dock">${dockHtml}</nav>
<div class="toast-host" aria-live="polite"></div>
<script src="/assets/dashboard.js"></script>
</body>
</html>`;
}

// ── Overview ───────────────────────────────────────────────────────────────
function overview(d) {
  const s = d.summary;
  const labels = s.labels || {};
  const kpis = `<div class="grid g4">
    ${kpi('URL tayang', num(s.total), `${num(d.counts.files)} berkas di collection · ${num(d.counts.redirects)} di antaranya 301`)}
    ${kpi('Sudah diukur Google', `${num(s.measured)}<span style="font-size:14px;color:var(--ink-3)">/${num(s.total)}</span>`, s.measured ? `${num(s.discoveryGap)} belum punya hasil inspeksi` : 'belum ada satu pun inspeksi GSC')}
    ${kpi('Index rate', pct(s.indexRate), s.measured ? 'dari yang punya hasil inspeksi' : 'n = 0 — bukan 0%')}
    ${kpi('Kuota publish', num(s.dailyCount), `artikel/hari · ${esc(d.config.updated_by || '—')}`)}
  </div>`;

  const alerts = s.alerts || [];
  const alertBox = alerts.length
    ? alerts.map((a) => callout(a.level === 'info' ? 'info' : a.level === 'warn' ? 'warn' : 'bad', `<b>${esc(a.code || 'alert')}</b> — ${esc(a.msg || JSON.stringify(a))}`)).join('')
    : callout('ok', 'Tidak ada alert dari ramp-gate atau remedi pada run terakhir.');

  const bar = stackedBar([
    ['indexed', COLOR.ok, labels.indexed || 0],
    ['not_indexed', COLOR.bad, labels.not_indexed || 0],
    ['blocked', COLOR.warn, labels.blocked || 0],
    ['belum diukur', COLOR.info, (labels.unknown || 0) + (labels.not_discovered || 0)],
  ]);

  const traffic = d.traffic.available
    ? `<div class="grid g3">
        ${kpi('Klik', num(d.traffic.clicks), `${num(d.traffic.queries)} query · ditambang ${esc(ago(d.traffic.minedAt))}`)}
        ${kpi('Impressi', num(d.traffic.impressions), `window ${num(d.traffic.windowDays)} hari`)}
        ${kpi('CTR', pct(d.traffic.impressions ? d.traffic.clicks / d.traffic.impressions : null, 2), 'dari query yang ditambang')}
      </div>`
    : callout('info', `<b>Trafik belum diukur.</b> Klik/impresi ditambang <code>runner/weekly.mjs</code> ke <code>${esc(d.traffic.path)}</code>; berkas itu belum ada karena <code>GSC_SERVICE_ACCOUNT_JSON</code> belum terpasang. <a href="/traffic">Detail →</a>`);

  const runsMini = table(
    [
      { label: 'Kapan', get: (r) => esc(date(r.at)) + ` <span style="color:var(--ink-4)">${esc(ago(r.at))}</span>` },
      { label: 'Jenis', get: (r) => esc(r.kind) },
      { label: 'Hasil', get: (r) => (r.exit === null ? chip('warn', 'tidak selesai') : chip(r.exit === 0 ? 'ok' : 'bad', r.exit === 0 ? 'sukses' : `exit ${r.exit}`)) },
      { label: 'Tahap', get: (r) => r.steps.map((st) => chip(st.status, st.name)).join(' ') },
    ],
    d.runs.slice(0, 5),
    { empty: 'Belum pernah ada run tercatat.' },
  );

  const gates = table(
    [
      { label: 'Gerbang', get: (g) => esc(g.name) },
      { label: 'Status', get: (g) => g.state },
      { label: 'Artinya', get: (g) => esc(g.note) },
    ],
    [
      { name: 'Persetujuan keyword', state: gateChip(Boolean(d.keywords.approvedAt), 'disetujui', 'tertutup'), note: d.keywords.approvedAt ? `approved_at ${d.keywords.approvedAt} oleh ${d.keywords.approvedBy || '—'}` : 'generate berhenti sebelum menulis draft; persetujuan hanya oleh manusia' },
      { name: 'Audit post', state: chip('ok', `${d.audit.total} keputusan`), note: `${d.audit.keep} keep · ${d.audit.redirect} redirect 301` },
      { name: 'Halt manual', state: chip(d.config.halt ? 'bad' : 'ok', d.config.halt ? 'HALT' : 'jalan'), note: d.config.halt ? d.config.halt_reason || 'tanpa alasan' : 'config.halt=false; publish sesuai kuota' },
      { name: 'Sitemap', state: chip(d.sitemap.exists && d.sitemap.urls > 0 ? 'ok' : 'bad', d.sitemap.exists ? `${d.sitemap.urls} URL` : 'tidak ada'), note: d.sitemap.exists ? `${d.sitemap.withLastmod} lastmod · dibangun ${hoursAgo(d.sitemap.ageHours)}` : `belum di-build (${d.sitemap.path})` },
    ],
  );

  return `
<h2>Inti</h2>
${kpis}
${alertBox}
<h2>Status indeks ${num(s.total)} URL tayang</h2>
${bar}
<h2>Trafik</h2>
${traffic}
<h2>Gerbang hari ini</h2>
${gates}
<h2>Run terakhir</h2>
${runsMini}
<p class="note">Angka dari <code>seo/state.json</code> + <code>seo/config.json</code> saat request. <a href="/runs">Riwayat run</a> · <a href="/health">Health</a> · <a href="/tracking">Tracking konten</a></p>`;
}

// ── Queue ──────────────────────────────────────────────────────────────────
function queue(d) {
  const q = d.queue;
  const k = d.keywords;
  const queuedSet = new Set(q.slugs);
  const liveSet = new Set(d.urlRows.map((u) => u.slug));
  const kpis = `<div class="grid g4">
    ${kpi('Antrean kerja', num(q.total), `draft ${num(q.counts.draft || 0)} · pending ${num(q.counts.pending || 0)} · published ${num(q.counts.published || 0)}`)}
    ${kpi('Keyword disetujui', `${num(k.approved)}<span style="font-size:14px;color:var(--ink-3)">/${num(k.total)}</span>`, k.minApproved ? `minimum ${num(k.minApproved)} agar generator tidak mengulang tema` : '')}
    ${kpi('Belum jadi artikel', num(k.unused), 'approved, slug belum ada di collection')}
    ${kpi('Kajian belum disetujui', num(k.suggested), 'hasil keyword-suggest --push (approved:false)')}
  </div>`;

  const ramp = d.ramp.lastRun;
  const rampBox = ramp
    ? table([
        { label: 'Keputusan', get: (r) => esc(r.decision ?? r.action ?? '—') },
        { label: 'daily_count', align: 'r', get: (r) => num(r.dailyCount ?? r.daily_count) },
        { label: 'Alasan', get: (r) => esc(r.reason || r.alasan || '—') },
        { label: 'Kapan', get: (r) => esc(date(r.at)) },
      ], [ramp])
    : callout('info', '<code>seo/ramp-gate.mjs</code> belum pernah menulis keputusan. Kuota hari ini = nilai seed <code>seo/config.json</code>: ' + esc(d.config.reason || 'tanpa alasan') + '.');

  const cfgRows = [
    ['daily_count', d.config.daily_count, 'artikel/hari yang boleh flip draft→published'],
    ['rentang', `${d.config.daily_count_min}–${d.config.daily_count_max}`, 'batas bawah/atas ramp-gate'],
    ['window indeks', `${d.config.index_window_days} hari`, 'jendela inspeksi GSC'],
    ['min_sample', d.config.min_sample, 'di bawah ini data terlalu tipis untuk naik kuota'],
    ['threshold up/down', `${d.config.threshold_up} / ${d.config.threshold_down}`, 'index rate penaik/penurun kuota'],
  ].map(([a, b, c]) => ({ a, b, c }));

  const kwCols = [
    { label: 'Keyword', get: (x) => esc(x.keyword) },
    { label: 'Slug', mono: true, get: (x) => esc(x.slug) },
    { label: 'Cluster', get: (x) => esc(x.cluster || '—') },
    { label: 'Geo', get: (x) => esc(x.geo || '—') },
    { label: 'Prio', align: 'r', get: (x) => num(x.priority) },
    { label: 'Setuju', get: (x) => chip(x.approved ? 'ok' : 'warn', x.approved ? 'ya' : 'belum') },
    { label: 'Sudah ada', get: (x) => (x.hasPost ? chip('ok', 'post live') : x.queued ? chip('info', 'di antrean') : '<span style="color:var(--ink-4)">—</span>') },
  ];
  const kwRows = k.items.map((x) => ({ ...x, hasPost: liveSet.has(x.slug), queued: queuedSet.has(x.slug) }));
  const KW_HEAD = 40;
  const kwTable = kwRows.length > KW_HEAD
    ? table(kwCols, kwRows.slice(0, KW_HEAD), { empty: 'Belum ada keyword.' }) + fold(`Tampilkan ${num(kwRows.length - KW_HEAD)} keyword lainnya`, table(kwCols, kwRows.slice(KW_HEAD)))
    : table(kwCols, kwRows, { empty: 'Belum ada keyword.' });

  const cities = table(
    [
      { label: 'Area', get: (c) => `<b>${esc(c.city || c.slug)}</b><br><span style="color:var(--ink-4)">${esc(c.provinsi || '')}</span>` },
      { label: 'Tier', align: 'r', get: (c) => chip(c.tier === 1 ? 'ok' : c.tier === 2 ? 'info' : 'warn', `T${num(c.tier)}`) },
      { label: 'Slug', mono: true, get: (c) => esc(c.slug) },
      { label: 'Pembeli yang dituju', get: (c) => esc(c.buyer || '—') },
    ],
    d.cities,
    { empty: 'cities.json kosong.' },
  );

  return `
<h2>Antrean dan kuota</h2>
${kpis}
${rampBox}
<h2>Parameter ramp (seo/config.json)</h2>
${table([{ label: 'Parameter', get: (r) => `<span class="mono">${esc(r.a)}</span>` }, { label: 'Nilai', get: (r) => esc(r.b) }, { label: 'Artinya', get: (r) => esc(r.c) }], cfgRows)}
<h2>Daftar keyword (${num(k.total)})</h2>
${kwTable}
<h2>Anchor area (seo/cities.json)</h2>
${cities}
<p class="note">Antrean dibangun ulang oleh <code>node seo/seed-queue.mjs</code>; sumbernya <code>keywords.json</code> yang disetujui manusia — bukan tempat mengarang topik.</p>`;
}

// ── URLs ───────────────────────────────────────────────────────────────────
function urls(d) {
  const rows = d.urlRows;
  const submitted = rows.filter((r) => r.submitted).length;
  const inspected = rows.filter((r) => r.verdict).length;
  const kpis = `<div class="grid g4">
    ${kpi('URL di daftar', num(rows.length), 'hanya yang tayang — 301 tidak diantri indeks')}
    ${kpi('Punya hasil inspeksi', num(inspected), inspected ? `${num(rows.length - inspected)} belum dicek ulang` : 'belum ada')}
    ${kpi('Dikirim IndexNow', num(submitted), 'Bing/Yandex; Google lewat sitemap')}
    ${kpi('Tayang tak tercatat', num(d.missing.length), d.missing.length ? 'perlu bootstrap-state ulang' : 'state cocok dengan disk')}
  </div>`;

  const warn = inspected === 0
    ? callout('warn', `<b>Belum ada hasil inspeksi.</b> Kolom verdict/coverage kosong sampai <code>GSC_SERVICE_ACCOUNT_JSON</code> terpasang dan <code>node seo/gsc-inspect.mjs --all</code> jalan. Ini belum diukur, bukan gagal indeks. <a href="/indexasi">Indexasi →</a>`)
    : '';

  const HEAD_ROWS = 12;
  const mkTable = (list) => table(
    [
      { label: 'Slug', get: (r) => `<a href="${esc(r.url)}" rel="nofollow noopener">${esc(r.slug)}</a>` },
      { label: 'Label', get: (r) => chip(r.label, r.label) },
      { label: 'Verdict', get: (r) => (r.verdict ? chip(r.verdict === 'Pass' ? 'ok' : 'bad', r.verdict) : '<span style="color:var(--ink-4)">—</span>') },
      { label: 'Coverage', get: (r) => esc(r.coverageState || '—') },
      { label: 'Crawl terakhir', get: (r) => esc(date(r.lastCrawlTime)) },
      { label: 'Dicek', get: (r) => esc(ago(r.lastChecked)) },
      { label: 'IndexNow', get: (r) => (r.submitted ? chip('ok', 'ya') : chip('warn', 'belum')) },
    ],
    list,
    { empty: 'Tidak ada URL published di state.json.' },
  );
  const head = rows.slice(0, HEAD_ROWS);
  const rest = rows.slice(HEAD_ROWS);
  const tbl = rest.length ? mkTable(head) + fold(`Tampilkan ${num(rest.length)} URL lainnya`, mkTable(rest)) : mkTable(rows);

  const missing = d.missing.length
    ? `<h2>Ada di disk, tidak ada di state</h2>${callout('bad', 'Tayang tapi mesin tidak pernah mencatatnya — <code>node seo/bootstrap-state.mjs</code> memasukkan tanpa mengubah konten.')}${table([
        { label: 'Slug', mono: true, get: (r) => esc(r.slug) },
        { label: 'Judul', get: (r) => esc(r.title) },
        { label: 'Tanggal', get: (r) => esc(date(r.date)) },
      ], d.missing)}`
    : '';

  return `<h2>Peta URL</h2>${kpis}${warn}${tbl}${missing}`;
}

// ── Content ────────────────────────────────────────────────────────────────
function content(d) {
  const kpis = `<div class="grid g4">
    ${kpi('Berkas collection', num(d.counts.files), 'site/src/collections/blog')}
    ${kpi('Tayang', num(d.counts.live), 'predikat sama dengan route Astro')}
    ${kpi('Redirect 301', num(d.counts.redirects), 'keputusan audit')}
    ${kpi('Draft / review', num(d.counts.drafts), d.counts.drafts ? 'menunggu gerbang QC' : 'generator belum boleh jalan')}
  </div>`;

  const recent = table(
    [
      { label: 'Judul', get: (p) => esc(p.title) },
      { label: 'Slug', mono: true, get: (p) => esc(p.slug) },
      { label: 'Diperbarui', get: (p) => esc(date(p.updated)) },
      { label: 'Terbit', get: (p) => esc(date(p.date)) },
    ],
    d.recent,
    { empty: 'Tidak ada artikel yang frontmatter-nya berubah dalam 30 hari terakhir.' },
  );

  const drafts = table(
    [
      { label: 'Judul', get: (p) => esc(p.title) },
      { label: 'Slug', mono: true, get: (p) => esc(p.slug) },
      { label: 'Status', get: (p) => chip(p.status === 'draft' ? 'warn' : 'info', p.status) },
    ],
    d.drafts,
    { empty: 'Tidak ada draft. <code>node seo/generate.mjs</code> berhenti di gerbang keyword selama <code>_meta.approved_at</code> null.' },
  );

  const redirects = d.audit.entries.filter(([, x]) => x?.action === 'redirect');
  const redirectTable = table(
    [
      { label: 'Dari', mono: true, get: ([slug]) => esc(slug) },
      { label: 'Ke', mono: true, get: ([, x]) => esc(x.to || '—') },
      { label: 'Alasan', get: ([, x]) => esc(x.reason || '—') },
    ],
    redirects,
    { empty: 'Tidak ada redirect.' },
  );

  return `
<h2>Konten</h2>
${kpis}
<h2>Berubah 30 hari terakhir</h2>
${recent}
<h2>Menunggu gerbang</h2>
${drafts}
<h2>Konsolidasi audit (${num(redirects.length)} redirect)</h2>
${redirectTable}
<p class="note">Halaman ini menghitung berkas di repo. Skor kualitas + internal link ada di <a href="/tracking">Tracking</a>; performa pencarian di <a href="/traffic">Traffic</a> (masih kosong sampai GSC terpasang).</p>`;
}

// ── Runs ───────────────────────────────────────────────────────────────────
function runs(d) {
  const last = d.runs[0] || null;
  const failed = d.runs.filter((r) => r.exit !== 0).length;
  const kpis = `<div class="grid g4">
    ${kpi('Run tercatat', num(d.runsTotal), `${num(d.runs.length)} terakhir di ${esc(d.runsPath)}`)}
    ${kpi('Run terakhir', last ? ago(last.at) : 'belum ada', last ? `${esc(last.kind)} · exit ${last.exit === null ? '—' : last.exit}` : '')}
    ${kpi('Yang tidak sukses', num(failed), 'termasuk dilewati & mati di tengah jalan')}
    ${kpi('Lock', d.lock ? chip('warn', 'dipegang') : chip('ok', 'kosong'), d.lock ? `${esc(d.lock.kind || d.lock.name || '?')} sejak ${esc(ago(d.lock.at))}` : 'tidak ada pipeline berjalan')}
  </div>`;

  const stepChips = (r) =>
    r.steps.length
      ? r.steps.map((st) => `<span class="chip ${st.status === 'ok' ? 'ok' : st.status === 'fail' || st.status === 'blocked' ? 'bad' : 'info'}" title="${esc(st.note || '')}">${esc(st.name)}: ${esc(st.status)}</span>`).join(' ')
      : '<span style="color:var(--ink-4)">tidak ada tahap tercatat</span>';

  const tbl = table(
    [
      { label: 'Mulai', get: (r) => `${esc(date(r.at))}<br><span style="color:var(--ink-4)">${esc(ago(r.at))}</span>` },
      { label: 'Jenis', get: (r) => esc(r.kind) },
      { label: 'Hasil', get: (r) => (r.exit === null ? chip('warn', 'tidak selesai') : chip(r.exit === 0 ? 'ok' : 'bad', r.exit === 0 ? 'sukses' : `exit ${r.exit}`)) },
      { label: 'Lock', get: (r) => esc(r.lock) },
      { label: 'Tahap', get: (r) => stepChips(r) },
      { label: 'Ringkas', mono: true, get: (r) => {
          const s = r.summary || {};
          const bits = [];
          if ('published' in s) bits.push(`url=${s.published}`);
          if ('measured' in s) bits.push(`ukur=${s.measured}`);
          if ('dailyCount' in s) bits.push(`kuota=${s.dailyCount}`);
          if ('draft' in s) bits.push(`draft=${s.draft}`);
          if (s.indexRate !== undefined && s.indexRate !== null) bits.push(`rate=${(s.indexRate * 100).toFixed(1)}%`);
          return esc(bits.join(' · ') || '—');
        } },
    ],
    d.runs,
    { empty: 'Belum ada run. Jalankan <code>node runner/daily.mjs</code> atau tombol di atas.' },
  );

  const stages = d.indexer
    ? `<h2>Tahap internal indexer terakhir</h2>${table([
        { label: 'Tahap', get: (x) => esc(x.name) },
        { label: 'Status', get: (x) => chip(x.status === 'ok' ? 'ok' : x.status === 'fail' ? 'bad' : 'info', x.status) },
        { label: 'Exit', align: 'r', get: (x) => num(x.code ?? null) },
        { label: 'ms', align: 'r', get: (x) => num(x.ms ?? null) },
        { label: 'Catatan', get: (x) => esc(x.reason || '—') },
      ], d.indexer.stages || [])}<p class="note">Window ${num(d.indexer.windowDays)} hari · ${esc(date(d.indexer.at))}${d.indexer.dryRun ? ' · <b>dry-run</b>' : ''}</p>`
    : callout('info', '<code>seo/indexer.mjs</code> belum pernah menyelesaikan run.');

  const measured = d.runs.slice().reverse().map((r) => ({ at: r.at, value: r.summary && typeof r.summary.indexRate === 'number' ? r.summary.indexRate : null }));
  const trend = spark(measured, { w: 520, h: 44 })
    ? `<h2>Index rate per run</h2><div class="card reveal" style="color:${COLOR.ok}">${spark(measured, { w: 520, h: 44 })}<p class="note">Titik hilang = run tanpa pengukuran; tidak digambar sebagai nol.</p></div>`
    : '';

  return `<h2>Riwayat eksekusi</h2>${kpis}${trend}${tbl}${stages}${auditSection()}`;
}

// ── Health ─────────────────────────────────────────────────────────────────
function health(d) {
  const sm = d.sitemap;
  const creds = table(
    [
      { label: 'Variabel', mono: true, get: (c) => esc(c.env) },
      { label: 'Fungsi', get: (c) => esc(c.role) },
      { label: 'Dipakai di', mono: true, get: (c) => esc(c.neededBy) },
      { label: 'Terpasang', get: (c) => chip(c.set ? 'ok' : 'warn', c.set ? 'ya' : 'belum') },
    ],
    d.credentials,
  );

  const fileTable = table(
    [
      { label: 'Berkas state', mono: true, get: (r) => esc(r.path) },
      { label: 'Terakhir ditulis', get: (r) => (r.mtime ? `${esc(date(r.mtime))} <span style="color:var(--ink-4)">${esc(ago(r.mtime))}</span>` : '<span style="color:var(--ink-4)">tidak ada di disk</span>') },
      { label: 'Isi', get: (r) => esc(r.note) },
    ],
    d.files,
  );

  const smAge = sm.ageHours;
  const smCallout = !sm.exists
    ? callout('bad', `<code>${esc(sm.path)}</code> tidak ada. Jalankan <code>npm --prefix site run build</code> — sitemap satu-satunya jalur Google menemukan URL baru.`)
    : smAge !== null && smAge > 30
      ? callout('warn', `Sitemap berumur ${num(smAge)} jam. Kalau runner harian mati, inilah penyebabnya — bukan Google yang lambat.`)
      : callout('ok', `Sitemap ${num(sm.urls)} URL, ${num(sm.withLastmod)} punya lastmod, dibangun ${hoursAgo(smAge)}.`);

  const bing = d.bing
    ? table([
        { label: 'Dikirim', align: 'r', get: (b) => num(b.submitted) },
        { label: 'Cooldown', align: 'r', get: (b) => num(b.skipped) },
        { label: 'Lewat kuota', align: 'r', get: (b) => num(b.overQuota) },
        { label: 'Kuota sesudah', align: 'r', get: (b) => `${num(b.quotaAfter)} / hari` },
        { label: 'Gagal', align: 'r', get: (b) => num(b.failures) },
      ], [d.bing])
    : callout('info', 'Bing belum pernah disubmit. IndexNow jalan sendiri, tidak memakan kuota Bing.');

  const accessChip = chip(d.access.mode === 'enforced' ? 'ok' : d.access.mode === 'enforce-off' ? 'warn' : 'bad', d.access.mode);

  return `
<h2>Sitemap</h2>
${smCallout}
<h2>Berkas state</h2>
${fileTable}
<h2>IndexNow</h2>
<div class="grid g3">
  ${kpi('URL dikirim', num(d.indexnow.submitted), 'state.indexnow.submitted')}
  ${kpi('Berkas kunci', d.indexnowKey.exists ? chip('ok', 'ada') : chip('bad', 'hilang'), `serve publik di <code>${esc(d.indexnowKey.servedAt)}</code>`)}
  ${kpi('Lokasi kunci', `<span style="font-size:14px" class="mono">${esc(d.indexnowKey.servedAt)}</span>`, `repo: <span class="mono">${esc(d.indexnowKey.path)}</span>`)}
</div>
<h2>Kuota / submit Bing</h2>
${bing}
<h2>Proteksi akses</h2>
${callout(d.access.mode === 'enforced' ? 'ok' : 'warn', `${accessChip} ${esc(d.access.note)}`)}
<h2>Kredensial (environment mesin, bukan browser Anda)</h2>
${creds}
${callout('info', 'Nilai variabel tidak pernah dibaca — hanya ada/tidaknya. Dashboard ini berjalan di container runner terpisah, tidak pernah ikut build situs publik.')}
<h2>Yang menahan pipeline hari ini</h2>
<ul>
  <li>Gerbang keyword: <b>${d.keywords.approvedAt ? 'disetujui' : 'tertutup'}</b> — generator tidak bisa menyetujui dirinya sendiri.</li>
  <li>Pengukuran GSC: <b>${d.summary.measured ? `${num(d.summary.measured)} URL terukur` : 'belum ada'}</b> — ramp ditahan di ${num(d.config.daily_count)}/hari.</li>
  <li>Deploy: <b>${d.credentials.find((c) => c.env === 'CLOUDFLARE_API_TOKEN')?.set ? 'siap' : 'belum tersambung'}</b> — publish butuh token Pages.</li>
</ul>`;
}

// ── Rank tracking + audit log (#19) ────────────────────────────────────────
function rankSection() {
  const r = readRank();
  if (!r.available) {
    return `<h2>Posisi keyword (rank tracking)</h2>${callout('info', `<b>Rank belum ditambang.</b> Jalankan <code>node seo/rank.mjs</code> (butuh GSC) untuk melacak posisi per keyword + alert turun &gt; ${num(CFG.rankDropAlert)} posisi. ${r.reason ? `Alasan: ${esc(r.reason)}.` : ''} Belum ditambang ≠ posisi 0.`)}`;
  }
  const deltaChip = (d) => {
    if (d == null) return '<span style="color:var(--ink-4)">baru</span>';
    if (d > CFG.rankDropAlert) return chip('bad', `▼${d}`);
    if (d < -CFG.rankDropAlert) return chip('ok', `▲${Math.abs(d)}`);
    return chip('info', d === 0 ? '±0' : d > 0 ? `▼${d}` : `▲${Math.abs(d)}`);
  };
  const kpis = `<div class="grid g4">
    ${kpi('Query dilacak', num(r.total), `window ${num(r.windowDays)} hari · ${esc(ago(r.generatedAt))}`)}
    ${kpi(`Turun >${num(CFG.rankDropAlert)}`, num(r.drops.length), r.drops.length ? 'perlu perhatian' : 'tidak ada penurunan tajam')}
    ${kpi(`Naik >${num(CFG.rankDropAlert)}`, num(r.improved.length), 'momentum positif')}
    ${kpi('Ambang alert', `${num(CFG.rankDropAlert)} posisi`, 'SEO_RANK_DROP')}
  </div>`;
  const cols = [
    { label: 'Query', get: (x) => esc(x.query) },
    { label: 'Posisi', align: 'r', get: (x) => Number(x.position).toFixed(1) },
    { label: 'Sebelum', align: 'r', get: (x) => (x.prevPosition == null ? '—' : Number(x.prevPosition).toFixed(1)) },
    { label: 'Δ', align: 'r', get: (x) => deltaChip(x.delta) },
    { label: 'Klik', align: 'r', get: (x) => num(x.clicks) },
    { label: 'Impressi', align: 'r', get: (x) => num(x.impressions) },
  ];
  const HEAD = 25;
  const rest = r.entries.slice(HEAD);
  const tbl = rest.length
    ? table(cols, r.entries.slice(0, HEAD), { empty: 'Tidak ada query.' }) + fold(`Tampilkan ${num(rest.length)} query lainnya`, table(cols, rest))
    : table(cols, r.entries, { empty: 'Tidak ada query.' });
  const drops = r.drops.length ? callout('warn', `${num(r.drops.length)} keyword turun lebih dari ${num(CFG.rankDropAlert)} posisi sejak penambangan sebelumnya.`) : '';
  return `<h2>Posisi keyword (rank tracking)</h2>${kpis}${drops}${tbl}<p class="note">Sumber: <code>seo/rank.json</code> · GSC Search Analytics dimensi query. Δ = perubahan posisi vs snapshot sebelumnya (▼ = turun/lebih buruk).</p>`;
}

function auditSection() {
  const entries = readAudit(50);
  if (!entries.length) {
    return `<h2>Audit log (mutasi dashboard)</h2>${callout('info', 'Belum ada mutasi yang dipicu dari dashboard. Setiap klik Generate/Publish/Inspect/Jalankan harian tercatat di sini: siapa, kapan, skrip apa.')}`;
  }
  const tbl = table(
    [
      { label: 'Waktu', get: (a) => `${esc(date(a.at))}<br><span style="color:var(--ink-4)">${esc(ago(a.at))}</span>` },
      { label: 'User', get: (a) => esc(a.user || '—') },
      { label: 'Aksi', mono: true, get: (a) => esc(a.action || '—') },
      { label: 'Skrip', mono: true, get: (a) => esc(a.script || '—') },
      { label: 'Argumen', mono: true, get: (a) => esc((a.args || []).join(' ') || '—') },
      { label: 'PID', align: 'r', get: (a) => num(a.pid ?? null) },
    ],
    entries,
    { empty: 'Belum ada mutasi.' },
  );
  return `<h2>Audit log (mutasi dashboard)</h2>${tbl}<p class="note">Jejak "siapa menekan tombol" — melengkapi Runs (hasil pipeline). Disimpan di <code>seo/audit-log.json</code> (volume).</p>`;
}

// ── Traffic (baru) ─────────────────────────────────────────────────────────
function traffic(d) {
  const t = d.traffic;
  if (!t.available) {
    return `
<h2>Trafik pencarian</h2>
${callout('info', `<b>Belum ada pengukuran trafik.</b> Klik/impresi/posisi berasal dari Google Search Analytics yang ditambang <code>runner/weekly.mjs</code> ke <code>${esc(t.path)}</code>. Berkas itu belum ada karena <code>GSC_SERVICE_ACCOUNT_JSON</code> belum terpasang (lihat <a href="/health">Health</a>). Window 7 dan 90 hari memang belum pernah diambil — dashboard tidak menaksirnya, dan tidak menolkan.`)}
<div class="grid g3">
  ${kpi('Klik', 'belum diukur', 'butuh GSC Search Analytics')}
  ${kpi('Impressi', 'belum diukur', 'butuh GSC Search Analytics')}
  ${kpi('Query tercatat', 'belum diukur', 'ditambang mingguan')}
</div>
<p class="note">Setelah GSC terpasang: <code>node runner/weekly.mjs</code> menambang window 28 hari, lalu halaman ini menampilkan query teratas + CTR. Tidak ada angka yang dikarang sebelum itu.</p>${rankSection()}`;
  }

  const ctr = t.impressions ? t.clicks / t.impressions : null;
  const kpis = `<div class="grid g4">
    ${kpi('Klik', num(t.clicks), `window ${num(t.windowDays)} hari · ditambang ${esc(ago(t.minedAt))}`)}
    ${kpi('Impressi', num(t.impressions), `${num(t.queries)} query tercatat`)}
    ${kpi('CTR', pct(ctr, 2), 'dari query yang ditambang, bukan seluruh properti')}
    ${kpi('Query', num(t.queries), `top ${num(t.top.length)} ditampilkan`)}
  </div>`;

  const top = table(
    [
      { label: 'Query', get: (x) => esc(x.query ?? x.keyword ?? '—') },
      { label: 'Klik', align: 'r', get: (x) => num(x.clicks ?? 0) },
      { label: 'Impressi', align: 'r', get: (x) => num(x.impressions ?? 0) },
      { label: 'CTR', align: 'r', get: (x) => pct(x.impressions ? (x.clicks || 0) / x.impressions : null, 2) },
      { label: 'Posisi', align: 'r', get: (x) => (x.position != null ? Number(x.position).toFixed(1) : '—') },
    ],
    t.top,
    { empty: 'Tidak ada query.' },
  );

  return `<h2>Trafik pencarian (window ${num(t.windowDays)} hari)</h2>${kpis}<h2>Query teratas</h2>${top}<p class="note">Sumber: <code>${esc(t.path)}</code>. Ini query yang sudah mendatangkan impresi — bukan seluruh keyword yang dibidik.</p>${rankSection()}`;
}

// ── Tracking (baru, #19) ───────────────────────────────────────────────────
function tracking(d, ctx) {
  const t = ctx.tracking;
  const funnelTbl = table(
    [
      { label: 'Tahap', get: (r) => esc(r.stage) },
      { label: 'Jumlah', align: 'r', get: (r) => (r.value === null ? '<span style="color:var(--ink-4)">belum diukur</span>' : num(r.value)) },
    ],
    t.funnel,
  );

  const scoreKpis = `<div class="grid g4">
    ${kpi('Artikel dinilai', num(t.total), 'hanya yang tayang')}
    ${kpi('Skor rata-rata', t.avgScore === null ? '—' : `${num(t.avgScore)}<span style="font-size:14px;color:var(--ink-3)">/100</span>`, 'heuristik teknis, bukan editorial')}
    ${kpi('Internal link', num(t.graph.edges), `rata-rata ${num(t.graph.avgOut)} keluar/artikel`)}
    ${kpi('Artikel yatim', num(t.graph.orphans.length), t.graph.orphans.length ? '0 inbound dari artikel lain' : 'semua punya inbound')}
  </div>`;

  const buckets = stackedBar([
    ['tinggi (≥80)', COLOR.ok, t.buckets.tinggi],
    ['sedang (55–79)', COLOR.warn, t.buckets.sedang],
    ['rendah (<55)', COLOR.bad, t.buckets.rendah],
  ]);

  const scoreChip = (s) => chip(s >= 80 ? 'ok' : s >= 55 ? 'warn' : 'bad', String(s));
  const artTable = (list) => table(
    [
      { label: 'Slug', mono: true, get: (a) => esc(a.slug) },
      { label: 'Skor', align: 'r', get: (a) => scoreChip(a.score) },
      { label: 'Kata', align: 'r', get: (a) => num(a.words) },
      { label: 'H2', align: 'r', get: (a) => num(a.h2) },
      { label: 'FAQ', align: 'r', get: (a) => num(a.faq) },
      { label: 'Gambar', get: (a) => (a.image ? chip('ok', 'ya') : chip('warn', 'tidak')) },
      { label: 'Related', align: 'r', get: (a) => num(a.related.length) },
      { label: 'Money link', get: (a) => (a.money ? chip('ok', 'ya') : chip('warn', 'tidak')) },
    ],
    list,
    { empty: 'Belum ada artikel tayang.' },
  );

  const HEAD = 15;
  const head = t.articles.slice(0, HEAD);
  const rest = t.articles.slice(HEAD);
  const arts = rest.length ? artTable(head) + fold(`Tampilkan ${num(rest.length)} artikel lainnya`, artTable(rest)) : artTable(t.articles);

  const orphans = t.graph.orphans.length
    ? `<h2>Artikel yatim (0 inbound)</h2>${callout('warn', 'Tidak ada artikel lain yang menaut ke sini. Tambahkan ke <code>related:</code> artikel setema agar tidak terisolasi.')}${table([
        { label: 'Slug', mono: true, get: (a) => esc(a.slug) },
        { label: 'Judul', get: (a) => esc(a.title) },
        { label: 'Skor', align: 'r', get: (a) => scoreChip(a.score) },
      ], t.graph.orphans)}`
    : '';

  const thin = t.thin.length
    ? `<h2>Konten tipis (&lt;900 kata)</h2>${table([
        { label: 'Slug', mono: true, get: (a) => esc(a.slug) },
        { label: 'Kata', align: 'r', get: (a) => num(a.words) },
        { label: 'Skor', align: 'r', get: (a) => scoreChip(a.score) },
      ], t.thin)}`
    : '';

  return `
<h2>Funnel produksi</h2>
${funnelTbl}
<h2>Kualitas &amp; internal link</h2>
${scoreKpis}
${buckets}
<p class="note">Bobot skor: kata≥900 (25) · H2≥3 (15) · FAQ≥5 (20) · gambar (15) · related≥3 (10) · money-link (10) · title+desc (5). Ini sinyal teknis kelayakan indeks, bukan penilaian mutu tulisan.</p>
${orphans}
${thin}
<h2>Skor per artikel (terendah dulu)</h2>
${arts}`;
}

// ── Indexasi (baru) ────────────────────────────────────────────────────────
function indexasi(d) {
  const s = d.summary;
  const labels = s.labels || {};
  const rows = d.urlRows;
  const inspected = rows.filter((r) => r.verdict).length;
  const kpis = `<div class="grid g4">
    ${kpi('Terukur', `${num(s.measured)}<span style="font-size:14px;color:var(--ink-3)">/${num(s.total)}</span>`, s.measured ? `${num(s.discoveryGap)} belum diinspeksi` : 'belum ada inspeksi GSC')}
    ${kpi('Index rate', pct(s.indexRate), s.measured ? 'indexed / discovered' : 'n = 0 — bukan 0%')}
    ${kpi('Discovery gap', num(s.discoveryGap), 'not_discovered + unknown')}
    ${kpi('IndexNow terkirim', num(d.indexnow.submitted), 'Bing/Yandex')}
  </div>`;

  const bar = stackedBar([
    ['indexed', COLOR.ok, labels.indexed || 0],
    ['not_indexed', COLOR.bad, labels.not_indexed || 0],
    ['blocked', COLOR.warn, labels.blocked || 0],
    ['not_discovered', COLOR.info, labels.not_discovered || 0],
    ['unknown', '#b9c2bf', labels.unknown || 0],
  ]);

  const warn = inspected === 0
    ? callout('warn', `<b>Belum ada hasil inspeksi.</b> Pasang <code>GSC_SERVICE_ACCOUNT_JSON</code> lalu jalankan <code>node seo/gsc-inspect.mjs --all</code> (atau tombol di atas). Google butuh OAuth user token untuk URL Inspection — service account ditolak.`)
    : callout('ok', `${num(inspected)} URL punya verdict. Inspeksi terakhir ${esc(ago(s.lastInspect))}.`);

  const mkTable = (list) => table(
    [
      { label: 'Slug', get: (r) => `<a href="${esc(r.url)}" rel="nofollow noopener">${esc(r.slug)}</a>` },
      { label: 'Label', get: (r) => chip(r.label, r.label) },
      { label: 'Verdict', get: (r) => (r.verdict ? chip(r.verdict === 'Pass' ? 'ok' : 'bad', r.verdict) : '<span style="color:var(--ink-4)">—</span>') },
      { label: 'Coverage', get: (r) => esc(r.coverageState || '—') },
      { label: 'Crawl terakhir', get: (r) => esc(date(r.lastCrawlTime)) },
      { label: 'Dicek', get: (r) => esc(ago(r.lastChecked)) },
    ],
    list,
    { empty: 'Tidak ada URL published.' },
  );
  const HEAD = 15;
  const head = rows.slice(0, HEAD);
  const rest = rows.slice(HEAD);
  const tbl = rest.length ? mkTable(head) + fold(`Tampilkan ${num(rest.length)} URL lainnya`, mkTable(rest)) : mkTable(rows);

  return `
<h2>Status indeks</h2>
${kpis}
${bar}
${warn}
<h2>Inspeksi per URL</h2>
${tbl}
<p class="note">Ramp-gate memakai index rate ini untuk menaikkan/menurunkan kuota publish. Selama belum terukur, kuota ditahan di ${num(d.config.daily_count)}/hari — itu fail-closed, bukan kerusakan.</p>`;
}

// ── Alerts (baru) ──────────────────────────────────────────────────────────
function alerts(d) {
  const items = [];
  for (const a of d.summary.alerts || []) items.push({ level: a.level || 'warn', code: a.code || 'alert', msg: a.msg || JSON.stringify(a) });
  if (d.ramp.alert && !items.some((i) => i.code === d.ramp.alert.code)) items.push({ level: d.ramp.alert.level || 'warn', code: d.ramp.alert.code || 'ramp', msg: d.ramp.alert.msg || '' });

  const blockers = [];
  if (!d.keywords.approvedAt) blockers.push({ code: 'keyword-gate', msg: 'Gerbang keyword tertutup — generate tidak bisa jalan sampai manusia menyetujui keywords.json.' });
  if (d.config.halt) blockers.push({ code: 'halt', msg: `config.halt=true: ${d.config.halt_reason || 'tanpa alasan'}. Reset manual diperlukan.` });
  const missingCreds = d.credentials.filter((c) => !c.set);
  if (missingCreds.length) blockers.push({ code: 'credentials', msg: `Belum terpasang: ${missingCreds.map((c) => c.env).join(', ')}.` });
  if (!d.sitemap.exists) blockers.push({ code: 'sitemap', msg: 'Sitemap belum di-build — Google tidak punya jalur menemukan URL baru.' });
  else if (d.sitemap.ageHours !== null && d.sitemap.ageHours > 30) blockers.push({ code: 'sitemap-stale', msg: `Sitemap berumur ${Math.round(d.sitemap.ageHours)} jam — runner harian mungkin mati.` });

  const alertCards = items.length
    ? items.map((a) => callout(a.level === 'info' ? 'info' : a.level === 'warn' ? 'warn' : 'bad', `<b>${esc(a.code)}</b> — ${esc(a.msg)}`)).join('')
    : callout('ok', 'Tidak ada alert aktif dari ramp-gate / remedi.');

  const blockerCards = blockers.length
    ? blockers.map((b) => callout('warn', `<b>${esc(b.code)}</b> — ${esc(b.msg)}`)).join('')
    : callout('ok', 'Tidak ada yang menahan pipeline: gerbang terbuka, kredensial lengkap, sitemap segar.');

  return `
<h2>Alert mesin</h2>
${alertCards}
<h2>Yang menahan pipeline</h2>
${blockerCards}
<h2>Proteksi akses</h2>
${callout(d.access.mode === 'enforced' ? 'ok' : 'warn', `${chip(d.access.mode === 'enforced' ? 'ok' : 'bad', d.access.mode)} ${esc(d.access.note)}`)}
<p class="note">Alert dibaca dari <code>state.rampGate.alert</code> + <code>state.remedyAlert</code>; blocker diturunkan dari gerbang, kredensial, dan umur sitemap. Tidak ada alert yang dikarang.</p>`;
}

// ── Registry + render ──────────────────────────────────────────────────────
const PAGES = {
  '/': { title: 'Overview', sub: 'Keadaan mesin SEO valleycityview.id saat ini', build: overview },
  '/traffic': { title: 'Traffic', sub: 'Klik & impresi dari Google Search Analytics', build: traffic },
  '/queue': { title: 'Antrean', sub: 'Keyword disetujui, kuota ramp, dan anchor area', build: queue },
  '/content': { title: 'Konten', sub: 'Berkas collection: tayang, draft, redirect', build: content },
  '/tracking': { title: 'Tracking', sub: 'Funnel produksi, skor kualitas, internal link, yatim', build: tracking },
  '/urls': { title: 'URL', sub: 'Peta URL tayang + status IndexNow', build: urls },
  '/indexasi': { title: 'Indexasi', sub: 'Inspeksi GSC per URL + index rate', build: indexasi },
  '/runs': { title: 'Runs', sub: 'Riwayat eksekusi pipeline termasuk yang dilewati', build: runs },
  '/health': { title: 'Health', sub: 'Sitemap, berkas state, kredensial, proteksi', build: health },
  '/alerts': { title: 'Alerts', sub: 'Alert mesin + yang menahan pipeline', build: alerts },
};

const ACTIONS = {
  '/runs': () => actionForm('/api/run-daily', 'Jalankan harian', 'play') + actionForm('/api/generate', 'Generate draft', 'refresh', 'ghost') + actionForm('/api/publish', 'Publish', 'external', 'ghost'),
  '/indexasi': () => actionForm('/api/inspect', 'Periksa indeks sekarang', 'search'),
};

export function pageList() {
  return Object.keys(PAGES);
}

function normalize(pathname) {
  let p = String(pathname || '/').split('?')[0];
  if (p === '/index.html') p = '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Rakit satu halaman. collect() dipanggil sekali per request; tracking hanya
 * dihitung untuk halaman yang memakainya (membaca body semua artikel = mahal).
 * Mengembalikan null untuk route yang tidak dikenal (server → 404).
 */
export function renderPage(pathname, opts = {}) {
  const key = normalize(pathname);
  const page = PAGES[key];
  if (!page) return null;
  const d = collect();
  const ctx = { user: opts.user || null, auth: hasAuth() };
  if (key === '/tracking') ctx.tracking = buildTracking(d);
  const body = polish(page.build(d, ctx));
  const actions = ACTIONS[key] ? ACTIONS[key](d, ctx) : '';
  return shell({ title: page.title, sub: page.sub, path: key, body, actions, d, user: ctx.user, auth: ctx.auth });
}
