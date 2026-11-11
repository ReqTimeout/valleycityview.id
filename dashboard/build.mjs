#!/usr/bin/env node
/**
 * dashboard/build.mjs — bangun dashboard valleyvity dari keadaan repo.
 *
 * Ini generator HTML statis, bukan server. Outputnya `dashboard/dist/` dan itu
 * yang di-deploy ke proyek Cloudflare Pages TERPISAH (bukan valleycity.id).
 * Tidak ada satu pun route dashboard yang boleh muncul di `site/src/pages/`:
 * satu halaman bocor ke domain publik = data internal kebayar publik.
 *
 * Cara pakai:
 *   node dashboard/build.mjs            # tulis dashboard/dist/
 *   node dashboard/build.mjs --check    # bangun ke memori, gagalkan kalau ada
 *                                       # 'undefined'/'NaN' atau halaman hilang
 *
 * Prinsip yang sama dengan seo/: apa yang belum diukur ditulis sebagai belum
 * diukur. Dashboard yang menampilkan 0 untuk sesuatu yang tidak pernah diukur
 * lebih berbahaya dari dashboard yang bolong.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DASHBOARD_DIST } from '../seo/paths.mjs';
import { collect } from './lib/data.mjs';
import { layout, table, kpi, chip, esc, num, pct, date, ago, stackedBar, spark, fold } from './lib/ui.mjs';

const CHECK = process.argv.includes('--check');
const d = collect();

const COLOR = { ok: '#1c7c54', bad: '#a52020', warn: '#9a6b00', info: '#74817e', accent: '#c9ad00' };

/** Umur dalam jam → teks, untuk berkas yang tidak punya timestamp ISO. */
function hoursAgo(h) {
  if (h === null || h === undefined) return 'waktu tidak diketahui';
  if (h < 1) return 'baru saja';
  if (h < 48) return `${Math.round(h)} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

/** Helper: callout yang hanya muncul kalau memang ada yang perlu dikatakan. */
function callout(kind, html) {
  return `<div class="callout ${kind}">${html}</div>`;
}
const gateChip = (ok, yes = 'terbuka', no = 'tertutup') => chip(ok ? 'ok' : 'bad', ok ? yes : no);

// ── Overview ───────────────────────────────────────────────────────────────
function overview() {
  const s = d.summary;
  const labels = s.labels || {};
  const kpis = `<div class="grid g4">
    ${kpi('URL tayang', num(s.total), `${num(d.counts.files)} berkas di collection · ${num(d.counts.redirects)} di antaranya 301`)}
    ${kpi('Sudah diukur Google', `${num(s.measured)}<span style="font-size:14px;color:var(--ink-3)">/${num(s.total)}</span>`, s.measured ? `${num(s.discoveryGap)} belum punya hasil inspeksi` : 'belum ada satu pun inspeksi GSC')}
    ${kpi('Index rate', pct(s.indexRate), s.measured ? 'dari yang punya hasil inspeksi' : 'n = 0 — angka ini tidak boleh dibaca sebagai 0%')}
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
        ${kpi('Klik 28 hari', num(d.traffic.clicks), `${num(d.traffic.queries)} query tercatat · ditambang ${esc(ago(d.traffic.minedAt))}`)}
        ${kpi('Impressi 28 hari', num(d.traffic.impressions), `window ${num(d.traffic.windowDays)} hari`)}
        ${kpi('CTR', pct(d.traffic.impressions ? d.traffic.clicks / d.traffic.impressions : null, 2), 'dihitung dari query yang ditambang, bukan seluruh properti')}
      </div>`
    : callout(
        'info',
        `<b>Trafik belum diukur.</b> Klik/impresmi datang dari Search Analytics yang ditambang <code>runner/weekly.mjs</code> ke <code>${esc(d.traffic.path)}</code>; berkas itu belum ada karena <code>GSC_SERVICE_ACCOUNT_JSON</code> belum terpasang. Window 7 dan 90 hari memang belum pernah diambil — dashboard tidak menaksirnya.`,
      );

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
      {
        name: 'Persetujuan keyword',
        state: gateChip(Boolean(d.keywords.approvedAt), 'disetujui', 'tertutup'),
        note: d.keywords.approvedAt
          ? `_meta.approved_at = ${d.keywords.approvedAt} oleh ${d.keywords.approvedBy || '—'}`
          : 'generate berhenti sebelum menulis draft; persetujuan hanya bisa diberikan manusia',
      },
      {
        name: 'Audit 71 post',
        state: chip('ok', `${d.audit.total} keputusan`),
        note: `${d.audit.keep} keep · ${d.audit.redirect} redirect 301 — gate content audit Fase 10`,
      },
      {
        name: 'Halt manual',
        state: chip(d.config.halt ? 'bad' : 'ok', d.config.halt ? 'HALT' : 'jalan'),
        note: d.config.halt ? d.config.halt_reason || 'tanpa alasan' : 'config.halt=false; publish boleh jalan sesuai kuota',
      },
      {
        name: 'Sitemap',
        state: chip(d.sitemap.exists && d.sitemap.urls > 0 ? 'ok' : 'bad', d.sitemap.exists ? `${d.sitemap.urls} URL` : 'tidak ada'),
        note: d.sitemap.exists
          ? `${d.sitemap.withLastmod} baris punya lastmod terbukti · dibangun ${hoursAgo(d.sitemap.ageHours)}`
          : `belum di-build (${d.sitemap.path})`,
      },
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
<p class="note">Semua angka di halaman ini berasal dari <code>seo/state.json</code> + <code>seo/config.json</code> pada saat build. <a href="/runs/">Lihat riwayat run</a> · <a href="/health/">Health</a></p>`;
}

// ── Queue ──────────────────────────────────────────────────────────────────
function queue() {
  const q = d.queue;
  const k = d.keywords;
  const queuedSet = new Set(q.slugs);
  const liveSet = new Set(d.urlRows.map((u) => u.slug));
  const kpis = `<div class="grid g4">
    ${kpi('Antrean kerja', num(q.total), `draft ${num(q.counts.draft || 0)} · pending ${num(q.counts.pending || 0)} · published ${num(q.counts.published || 0)}`)}
    ${kpi('Keyword disetujui', `${num(k.approved)}<span style="font-size:14px;color:var(--ink-3)">/${num(k.total)}</span>`, k.minApproved ? `minimum ${num(k.minApproved)} supaya generator tidak mengulang tema` : '')}
    ${kpi('Belum jadi artikel', num(k.unused), 'approved, slug-nya belum ada di collection')}
    ${kpi('Kajian belum disetujui', num(k.suggested), 'hasil keyword-suggest --push (approved:false)')}
  </div>`;

  const ramp = d.ramp.lastRun;
  const rampBox = ramp
    ? table(
        [
          { label: 'Keputusan', get: (r) => esc(r.decision ?? r.action ?? '—') },
          { label: 'daily_count', align: 'r', get: (r) => num(r.dailyCount ?? r.daily_count) },
          { label: 'Alasan', get: (r) => esc(r.reason || r.alasan || '—') },
          { label: 'Kapan', get: (r) => esc(date(r.at)) },
        ],
        [ramp],
      )
    : callout('info', '<code>seo/ramp-gate.mjs</code> belum pernah menulis keputusan ke state. Kuota yang dipakai hari ini adalah nilai seed di <code>seo/config.json</code>: ' + esc(d.config.reason || 'tanpa alasan') + '.');

  const cfgRows = [
    ['daily_count', d.config.daily_count, 'artikel/hari yang boleh flip draft→published'],
    ['rentang', `${d.config.daily_count_min}–${d.config.daily_count_max}`, 'batas bawah/atas yang boleh dipilih ramp-gate'],
    ['window indeks', `${d.config.index_window_days} hari`, 'jendela inspeksi GSC yang jadi dasar ukuran'],
    ['min_sample', d.config.min_sample, 'di bawah ini data dianggap terlalu tipis untuk menaikkan kuota'],
    ['threshold up/down', `${d.config.threshold_up} / ${d.config.threshold_down}`, 'index rate yang menaikkan / menurunkan kuota'],
  ].map(([a, b, c]) => ({ a, b, c }));

  const kwTable = table(
    [
      { label: 'Keyword', get: (x) => esc(x.keyword) },
      { label: 'Slug', mono: true, get: (x) => esc(x.slug) },
      { label: 'Cluster', get: (x) => esc(x.cluster || '—') },
      { label: 'Geo', get: (x) => esc(x.geo || '—') },
      { label: 'Prio', align: 'r', get: (x) => num(x.priority) },
      { label: 'Setuju', get: (x) => chip(x.approved ? 'ok' : 'warn', x.approved ? 'ya' : 'belum') },
      { label: 'Sudah ada', get: (x) => (x.hasPost ? chip('ok', 'post live') : x.queued ? chip('info', 'di antrean') : '<span style="color:var(--ink-4)">—</span>') },
    ],
    k.items.map((x) => ({ ...x, hasPost: liveSet.has(x.slug), queued: queuedSet.has(x.slug) })),
    { empty: 'Belum ada keyword.' },
  );

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
<p class="note">Antrean dibangun ulang oleh <code>node seo/seed-queue.mjs</code>; berkas <code>seo/queue.json</code> bukan tempat mengarang topik — sumbernya <code>keywords.json</code> yang Anda setujui.</p>`;
}

// ── URLs ───────────────────────────────────────────────────────────────────
function urls() {
  const rows = d.urlRows;
  const submitted = rows.filter((r) => r.submitted).length;
  const inspected = rows.filter((r) => r.verdict).length;
  const kpis = `<div class="grid g4">
    ${kpi('URL di daftar', num(rows.length), 'hanya yang tayang — yang 301 tidak diantriin untuk indeks')}
    ${kpi('Punya hasil inspeksi', num(inspected), inspected ? `${num(rows.length - inspected)} belum dicek ulang 24j terakhir` : 'belum ada')}
    ${kpi('Dikirim IndexNow', num(submitted), 'Bing/Yandex; Google tetap lewat sitemap')}
    ${kpi('Tayang tapi tak tercatat', num(d.missing.length), d.missing.length ? 'perlu bootstrap-state ulang' : 'state cocok dengan disk')}
  </div>`;

  const warn = inspected === 0
    ? callout('warn', `<b>Belum ada satu pun hasil inspeksi.</b> Kolom verdict/coverage akan tetap kosong sampai <code>GSC_SERVICE_ACCOUNT_JSON</code> terpasang dan <code>node seo/gsc-inspect.mjs --all</code> jalan. Ini bukan kegagalan indeks — ini belum diukur.`)
    : '';

  // 54 baris yang kolom verdict-nya semuanya "—" bukan informasi per baris;
  // membentangkannya di layar 390 px hanya memaksa orang menggulir. Sisa
  // barisnya masuk <details> — tetap ada, tetap bisa dibuka tanpa JavaScript.
  const HEAD_ROWS = 12;
  const head = rows.slice(0, HEAD_ROWS);
  const rest = rows.slice(HEAD_ROWS);
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
  const tbl = rest.length ? mkTable(head) + fold(`Tampilkan ${num(rest.length)} URL lainnya`, mkTable(rest)) : mkTable(rows);

  const missing = d.missing.length
    ? `<h2>Ada di disk, tidak ada di state</h2>${callout('bad', 'Artikel ini tayang tapi mesin tidak pernah mencatatnya — <code>node seo/bootstrap-state.mjs</code> akan memasukkannya tanpa mengubah berkas konten.')}${table(
        [
          { label: 'Slug', mono: true, get: (r) => esc(r.slug) },
          { label: 'Judul', get: (r) => esc(r.title) },
          { label: 'Tanggal', get: (r) => esc(date(r.date)) },
        ],
        d.missing,
      )}`
    : '';

  return `
<h2>Peta URL</h2>
${kpis}
${warn}
${tbl}
${missing}`;
}

// ── Content ────────────────────────────────────────────────────────────────
function content() {
  const kpis = `<div class="grid g4">
    ${kpi('Berkas collection', num(d.counts.files), 'site/src/collections/blog')}
    ${kpi('Tayang', num(d.counts.live), 'predikat sama dengan route Astro')}
    ${kpi('Redirect 301', num(d.counts.redirects), 'keputusan audit Fase 10')}
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
    { empty: 'Tidak ada artikel yang frontmatter-nya berubah dalam 30 hari terakhir. (Tanggal dibaca dari <code>updated:</code> di berkas — bukan dari waktu build.)' },
  );

  const drafts = table(
    [
      { label: 'Judul', get: (p) => esc(p.title) },
      { label: 'Slug', mono: true, get: (p) => esc(p.slug) },
      { label: 'Status', get: (p) => chip(p.status === 'draft' ? 'warn' : 'info', p.status) },
    ],
    d.drafts,
    { empty: 'Tidak ada draft. <code>node seo/generate.mjs</code> berhenti di gerbang keyword selama <code>_meta.approved_at</code> masih null.' },
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
<h2>Konsolidasi audit (17 redirect)</h2>
${redirectTable}
<p class="note">Halaman ini hanya menghitung berkas di repo. Tidak ada satu pun angka "performa konten" di sini — performa ada di kolom Google, dan kolom itu masih kosong.</p>`;
}

// ── Runs ───────────────────────────────────────────────────────────────────
function runs() {
  const last = d.runs[0] || null;
  const failed = d.runs.filter((r) => r.exit !== 0).length;
  const kpis = `<div class="grid g4">
    ${kpi('Run tercatat', num(d.runsTotal), `${num(d.runs.length)} yang terakhir disimpan di ${esc(d.runsPath)}`)}
    ${kpi('Run terakhir', last ? ago(last.at) : 'belum ada', last ? `${esc(last.kind)} · exit ${last.exit === null ? '—' : last.exit}` : '')}
    ${kpi('Yang tidak sukses', num(failed), 'termasuk yang dilewati dan yang mati di tengah jalan')}
    ${kpi('Lock', d.lock ? chip('warn', 'dipegang') : chip('ok', 'kosong'), d.lock ? `${esc(d.lock.kind || d.lock.name || '?')} sejak ${esc(ago(d.lock.at))}` : 'tidak ada pipeline yang berjalan')}
  </div>`;

  const stepChips = (r) =>
    r.steps.length
      ? r.steps.map((st) => `<span class="chip ${st.status === 'ok' ? 'ok' : st.status === 'fail' ? 'bad' : st.status === 'blocked' ? 'bad' : 'info'}" title="${esc(st.note || '')}">${esc(st.name)}: ${esc(st.status)}</span>`).join(' ')
      : '<span style="color:var(--ink-4)">tidak ada tahap tercatat</span>';

  const tbl = table(
    [
      { label: 'Mulai', get: (r) => `${esc(date(r.at))}<br><span style="color:var(--ink-4)">${esc(ago(r.at))}</span>` },
      { label: 'Jenis', get: (r) => esc(r.kind) },
      { label: 'Hasil', get: (r) => (r.exit === null ? chip('warn', 'tidak selesai') : chip(r.exit === 0 ? 'ok' : 'bad', r.exit === 0 ? 'sukses' : `exit ${r.exit}`)) },
      { label: 'Lock', get: (r) => esc(r.lock) },
      { label: 'Tahap', get: (r) => stepChips(r) },
      {
        label: 'Ringkas',
        mono: true,
        get: (r) => {
          const s = r.summary || {};
          const bits = [];
          if ('published' in s) bits.push(`url=${s.published}`);
          if ('measured' in s) bits.push(`ukur=${s.measured}`);
          if ('dailyCount' in s) bits.push(`kuota=${s.dailyCount}`);
          if ('draft' in s) bits.push(`draft=${s.draft}`);
          if (s.indexRate !== undefined && s.indexRate !== null) bits.push(`rate=${(s.indexRate * 100).toFixed(1)}%`);
          return esc(bits.join(' · ') || '—');
        },
      },
    ],
    d.runs,
    { empty: 'Belum ada run. Jalankan <code>node runner/daily.mjs</code> untuk membuat entri pertama.' },
  );

  const stages = d.indexer
    ? `<h2>Tahap internal indexer terakhir</h2>${table(
        [
          { label: 'Tahap', get: (x) => esc(x.name) },
          { label: 'Status', get: (x) => chip(x.status === 'ok' ? 'ok' : x.status === 'fail' ? 'bad' : 'info', x.status) },
          { label: 'Exit', align: 'r', get: (x) => num(x.code ?? null) },
          { label: 'ms', align: 'r', get: (x) => num(x.ms ?? null) },
          { label: 'Catatan', get: (x) => esc(x.reason || '—') },
        ],
        d.indexer.stages || [],
      )}<p class="note">Window ${num(d.indexer.windowDays)} hari · ${esc(date(d.indexer.at))}${d.indexer.dryRun ? ' · <b>dry-run</b>, tidak ada yang benar-benar dijalankan' : ''}</p>`
    : callout('info', '<code>seo/indexer.mjs</code> belum pernah menyelesaikan run, jadi tidak ada rincian tahap.');

  const measured = d.runs
    .slice()
    .reverse()
    .map((r) => ({ at: r.at, value: r.summary && typeof r.summary.indexRate === 'number' ? r.summary.indexRate : null }));

  const trend = spark(measured, { w: 520, h: 44 })
    ? `<h2>Index rate per run</h2><div style="color:${COLOR.ok}">${spark(measured, { w: 520, h: 44 })}</div><p class="note">Titik hilang = run yang tidak punya pengukuran. Yang tidak diukur tidak digambar sebagai nol.</p>`
    : '';

  return `
<h2>Riwayat eksekusi</h2>
${kpis}
${trend}
${tbl}
${stages}`;
}

// ── Health ─────────────────────────────────────────────────────────────────
function health() {
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
    ? callout('bad', `<code>${esc(sm.path)}</code> tidak ada. Jalankan <code>npm --prefix site run build</code> — sitemap adalah satu-satunya jalur Google menemukan URL baru.`)
    : smAge !== null && smAge > 30
      ? callout('warn', `Sitemap berumur ${num(smAge)} jam. Kalau runner harian mati, inilah penyebabnya — bukan Google yang lambat.`)
      : callout('ok', `Sitemap ${num(sm.urls)} URL, ${num(sm.withLastmod)} di antaranya punya <code>lastmod</code> yang terbukti, dibangun ${hoursAgo(smAge)}.`);

  const bing = d.bing
    ? table(
        [
          { label: 'Dikirim', align: 'r', get: (b) => num(b.submitted) },
          { label: 'Didinginkan (cooldown)', align: 'r', get: (b) => num(b.skipped) },
          { label: 'Lewat kuota', align: 'r', get: (b) => num(b.overQuota) },
          { label: 'Kuota sesudah', align: 'r', get: (b) => `${num(b.quotaAfter)} / hari` },
          { label: 'Gagal', align: 'r', get: (b) => num(b.failures) },
        ],
        [d.bing],
      )
    : callout('info', 'Bing belum pernah disubmit. IndexNow jalan sendiri dan tidak memakan kuota Bing.');

  return `
<h2>Sitemap</h2>
${smCallout}
<h2>Berkas state</h2>
${fileTable}
<h2>IndexNow</h2>
<div class="grid g3">
  ${kpi('URL dikirim', num(d.indexnow.submitted), 'daftar di state.indexnow.submitted')}
  ${kpi('Berkas kunci', d.indexnowKey.exists ? chip('ok', 'ada') : chip('bad', 'hilang'), `serve publik di <code>${esc(d.indexnowKey.servedAt)}</code> — memang seharusnya publik`)}
  ${kpi('Lokasi kunci', `<span style="font-size:14px" class="mono">${esc(d.indexnowKey.servedAt)}</span>`, `berkas di repo: <span class="mono">${esc(d.indexnowKey.path)}</span>`)}
</div>
<h2>Kuota / submit Bing</h2>
${bing}
<h2>Kredensial yang terlihat saat build</h2>
${creds}
${callout('info', 'Daftar ini mencerminkan environment <b>mesin yang membangun</b> (container runner), bukan komputer yang membuka halaman ini. Nilai variabel tidak pernah dibaca, hanya ada/tidaknya. Di situs publik, <code>site/dist</code> dan <code>dashboard/dist</code> dibangun terpisah: dashboard ada di proyek Cloudflare Pages sendiri dan tidak boleh muncul di domain valleycity.id.')}
<h2>Yang menahan pipeline hari ini</h2>
<ul>
  <li>Gerbang keyword: <b>${d.keywords.approvedAt ? 'disetujui' : 'tertutup'}</b> — generator tidak bisa menyetujui dirinya sendiri.</li>
  <li>Pengukuran GSC: <b>${d.summary.measured ? `${num(d.summary.measured)} URL terukur` : 'belum ada'}</b> — ramp ditahan di ${num(d.config.daily_count)}/hari.</li>
  <li>Deploy: <b>${d.credentials.find((c) => c.env === 'CLOUDFLARE_API_TOKEN')?.set ? 'siap' : 'belum tersambung'}</b> — publish butuh token Pages.</li>
</ul>`;
}

// ── tulis ──────────────────────────────────────────────────────────────────
const PAGES = [
  { path: '/', file: 'index.html', title: 'Overview', body: overview },
  { path: '/queue/', file: 'queue/index.html', title: 'Antrean', body: queue },
  { path: '/urls/', file: 'urls/index.html', title: 'URL', body: urls },
  { path: '/content/', file: 'content/index.html', title: 'Konten', body: content },
  { path: '/runs/', file: 'runs/index.html', title: 'Runs', body: runs },
  { path: '/health/', file: 'health/index.html', title: 'Health', body: health },
];

const robots = 'User-agent: *\nDisallow: /\n';
const headers = `/*
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Cache-Control: no-store
`;

const problems = [];
const built = [];
for (const p of PAGES) {
  let body;
  try {
    body = p.body();
  } catch (e) {
    problems.push(`${p.file}: body() gagal — ${e.message}`);
    continue;
  }
  const html = layout({ title: p.title, path: p.path, body, generatedAt: d.generatedAt, brand: d.brand, site: d.site, access: d.access });
  // Penjaga kualitas teks: 'undefined'/'NaN' yang lolos ke layar artinya
  // snapshot berubah bentuk dan tidak ada yang sadar.
  for (const bad of ['undefined', 'NaN', '[object Object]', 'null,']) {
    if (html.includes(bad)) problems.push(`${p.file}: mengandung "${bad}"`);
  }
  built.push({ ...p, html, bytes: Buffer.byteLength(html) });
}

if (!CHECK) {
  rmSync(DASHBOARD_DIST, { recursive: true, force: true });
  for (const f of built) {
    const out = join(DASHBOARD_DIST, f.file);
    mkdirSync(join(out, '..'), { recursive: true });
    writeFileSync(out, f.html);
  }
  mkdirSync(DASHBOARD_DIST, { recursive: true });
  writeFileSync(join(DASHBOARD_DIST, 'robots.txt'), robots);
  writeFileSync(join(DASHBOARD_DIST, '_headers'), headers);
}

const totalBytes = built.reduce((a, f) => a + f.bytes, 0);
console.log(`dashboard: ${built.length} halaman · ${(totalBytes / 1024).toFixed(1)} KB HTML · ${CHECK ? 'check' : '→ ' + DASHBOARD_DIST}`);
for (const f of built) console.log(`  ${(f.bytes / 1024).toFixed(1).padStart(5)} KB  ${f.file}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} masalah:`);
  for (const p of problems) console.error('  · ' + p);
  process.exitCode = 1;
} else if (!built.length) {
  console.error('\n❌ tidak ada halaman yang berhasil dibangun');
  process.exitCode = 1;
}
