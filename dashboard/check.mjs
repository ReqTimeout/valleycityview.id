#!/usr/bin/env node
/**
 * dashboard/check.mjs — gerbang hasil build dashboard.
 *
 * Bukan tes estetika. Yang dijaga di sini hal-hal yang kalau salah jadi
 * diam-diam merusak: halaman hilang, JavaScript nyelip (dashboard ini harus
 * nol JS — tidak ada alasan satu pun untuk menjalankannya di browser),
 * `noindex` hilang di salah satu dari tiga tempat, path mesin build bocor ke
 * HTML yang ter-deploy, dan angka yang hilang ditulis sebagai `undefined`.
 *
 * Keluar: exit 1 + daftar masalah. Jalankan sesudah build; `--build` menjalankan
 * build dulu (untuk runner).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

import { DASHBOARD_DIST } from '../seo/paths.mjs';

if (process.argv.includes('--build')) {
  const r = spawnSync(process.execPath, [join(process.cwd(), 'dashboard/build.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('build gagal');
    process.exit(1);
  }
}

const EXPECTED = [
  'index.html',
  'queue/index.html',
  'urls/index.html',
  'content/index.html',
  'runs/index.html',
  'health/index.html',
];

const MAX_PAGE_KB = 60;
const MAX_TABLE_ROWS = 70;

const problems = [];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(DASHBOARD_DIST)) {
  console.error(`❌ ${DASHBOARD_DIST} belum ada — jalankan node dashboard/build.mjs dulu`);
  process.exit(1);
}

const files = walk(DASHBOARD_DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));

for (const relPath of EXPECTED) {
  if (!htmlFiles.includes(join(DASHBOARD_DIST, relPath))) problems.push(`halaman hilang: ${relPath}`);
}

// robots.txt + _headers + <meta robots> — tiga lapis, dan hilangnya salah
// satunya tidak kelihatan di layar mana pun.
const robots = existsSync(join(DASHBOARD_DIST, 'robots.txt')) ? readFileSync(join(DASHBOARD_DIST, 'robots.txt'), 'utf8') : '';
if (!/Disallow:\s*\/\s*$/.test(robots)) problems.push('robots.txt tidak melarang seluruh path');

const headers = existsSync(join(DASHBOARD_DIST, '_headers')) ? readFileSync(join(DASHBOARD_DIST, '_headers'), 'utf8') : '';
if (!/X-Robots-Tag:\s*noindex/i.test(headers)) problems.push('_headers tidak memuat X-Robots-Tag: noindex');
if (!/Cache-Control:\s*no-store/i.test(headers)) problems.push('_headers tidak memuat Cache-Control: no-store (dinding Access bisa ter-cache)');

for (const f of files) {
  const relPath = relative(DASHBOARD_DIST, f);
  const src = readFileSync(f, 'utf8');
  const kb = statSync(f).size / 1024;

  if (f.endsWith('.html')) {
    if (!/name="robots"\s+content="noindex/.test(src)) problems.push(`${relPath}: <meta name="robots"> noindex hilang`);
    if (/<script[\s>]/i.test(src)) problems.push(`${relPath}: ada <script> — dashboard harus nol JavaScript`);
    if (/<meta[^>]+http-equiv=["']refresh/i.test(src)) problems.push(`${relPath}: http-equiv refresh tidak diizinkan`);
    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      if (src.includes(bad)) problems.push(`${relPath}: mengandung "${bad}"`);
    }
    // Path absolut mesin build tidak boleh ikut ter-deploy.
    const leak = src.match(/\/(Users|Volumes|home|app)\/[A-Za-z0-9._/-]*/g);
    if (leak) problems.push(`${relPath}: bocor path mesin — ${leak.slice(0, 2).join(', ')}`);
    if (kb > MAX_PAGE_KB) problems.push(`${relPath}: ${kb.toFixed(1)} KB > ${MAX_PAGE_KB} KB (halaman terlalu panjang — pecah atau ringkas)`);
    const rows = (src.match(/<tr>/g) || []).length;
    if (rows > MAX_TABLE_ROWS) problems.push(`${relPath}: ${rows} baris tabel > ${MAX_TABLE_ROWS} (F9: tidak ada scroll panjang)`);
    // Tautan internal harus ada halaman pasangannya.
    for (const m of src.matchAll(/href="(\/[^"#]*?)\/?"/g)) {
      const target = m[1];
      if (/^\/\//.test(target) || target.startsWith('//')) continue;
      const asFile = join(DASHBOARD_DIST, target === '/' ? 'index.html' : `${target.replace(/^\//, '')}/index.html`);
      if (!existsSync(asFile)) problems.push(`${relPath}: tautan internal mati → ${target}`);
    }
  }
}

// Yang boleh ada di dist cuma HTML, robots.txt, dan _headers. Sebuah .json
// di sini adalah cara lain untuk membocorkan state ke siapa pun yang tahu URL-nya.
const others = files.filter((f) => !f.endsWith('.html') && !/(^|\/)(robots\.txt|_headers)$/.test(relative(DASHBOARD_DIST, f)));
for (const f of others) {
  problems.push(`berkas tak dikenal di dist: ${relative(DASHBOARD_DIST, f)} — dashboard tidak punya aset selain HTML/robots.txt/_headers`);
}

console.log(`dashboard/check: ${htmlFiles.length} halaman · ${files.length} berkas · ${kbTotal(files)} KB total`);

function kbTotal(list) {
  return (list.reduce((a, f) => a + statSync(f).size, 0) / 1024).toFixed(1);
}

if (problems.length) {
  console.error(`\n❌ ${problems.length} masalah:`);
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log('✅ semua gerbang dashboard lolos (noindex 3 lapis, nol JS, tidak ada path bocor, halaman lengkap)');
