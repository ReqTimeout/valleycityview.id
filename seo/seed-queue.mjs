#!/usr/bin/env node
/**
 * seo/seed-queue.mjs — susun `seo/queue.json` dari dua kenyataan, bukan dari harapan.
 *
 * queue.json bukan sekadar antrean generate; dia adalah SATU-SATUNYA daftar
 * inventaris yang dibaca indexer, heal-queue, qc-uniqueness dan publish. Karena
 * itu dia diisi dari dua sumber:
 *
 *   1. 54 post impor yang masih hidup (status: publish, tidak di-redirect)
 *      -> tercatat `status: published`, `added_by: "impor"`. Ini yang membuat
 *      indexer hari pertama sudah tahu URL mana yang harus dicek di GSC, tanpa
 *      harus mengarang state kosong.
 *   2. keyword approved di keywords.json -> tercatat `status: pending`, dan
 *      kalau item itu bergeografi, `local_anchor`/`local_buyer` disalin dari
 *      cities.json di sini, bukan diharapkan dari kepatuhan model waktu generate.
 *
 * Yang digardai (semua exit 1, tidak ada yang "cuma peringatan"):
 *   - keywords.json belum di-approve manusia (`_meta.approved_at` null)
 *   - slug keyword menabrak post yang sudah ada  -> persis pola yang baru kami
 *     bersihkan dengan 17 redirect 301 di Fase 10; mesin tidak boleh
 *     menghasilkan tetangga kembar yang baru
 *   - slug keyword menabrak sumber/target redirect di audit/posts.json
 *   - `geo` tidak ada di cities.json
 *
 * Idempoten: item yang sudah ada di queue tidak ditimpa statusnya (status adalah
 * hasil kerja, bukan konfigurasi). Hanya field turunan (anchor, cluster, dsb.)
 * yang disegarkan.
 *
 * Usage: node seo/seed-queue.mjs [--dry] [--inventory-only]
 *
 * --inventory-only: tulis hanya 54 post impor (status published) dan BIARKAN
 * antrean generate kosong. Ini kondisi yang benar sebelum keywords.json
 * disetujui: indexer sudah punya daftar URL, tapi tidak ada satu pun topik
 * baru yang bisa di-generate. Dengan antrean kosong, keywordGate() di
 * generate.mjs balas 'queue kosong' — gagal dengan pesan, bukan crash.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  BLOG_DIR,
  QUEUE_PATH,
  KEYWORDS_PATH,
  CITIES_PATH,
  AUDIT_DECISIONS_PATH,
} from './paths.mjs';
import { isLive } from './lib/live-posts.mjs';

const dry = process.argv.includes('--dry');
const inventoryOnly = process.argv.includes('--inventory-only');

const die = (msg) => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};

const readJson = (p, label) => {
  if (!existsSync(p)) die(`${label} tidak ada: ${p}`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    die(`${label} bukan JSON valid: ${e.message}`);
  }
};

// ---- 1. Sumber ------------------------------------------------------------
const kwDoc = readJson(KEYWORDS_PATH, 'keywords.json');
const citiesDoc = readJson(CITIES_PATH, 'cities.json');
const audit = existsSync(AUDIT_DECISIONS_PATH)
  ? readJson(AUDIT_DECISIONS_PATH, 'audit/posts.json')
  : { decisions: {} };

const cityBySlug = new Map();
for (const c of citiesDoc.cities || []) if (c?.slug) cityBySlug.set(c.slug, c);

// Slug yang sudah ada di disk = collection yang benar-benar dirender.
const onDisk = new Set(
  existsSync(BLOG_DIR)
    ? readdirSync(BLOG_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
    : [],
);

// Post impor yang masih hidup: publish dan tidak di-redirect.
const live = [...onDisk].filter((slug) => {
  if (audit.decisions?.[slug]?.action === 'redirect') return false;
  const raw = readFileSync(join(BLOG_DIR, `${slug}.md`), 'utf8');
  return isLive(raw);
});

// ---- 2. Gerbang -----------------------------------------------------------
const approvedAt = kwDoc._meta?.approved_at;
if (!approvedAt && !dry && !inventoryOnly) {
  die(
    'keywords.json belum disetujui manusia (_meta.approved_at masih null) — ' +
      'lihat _meta.how_to_approve. Untuk menulis inventaris post impor saja: ' +
      'node seo/seed-queue.mjs --inventory-only',
  );
}

const approved = (kwDoc.items || []).filter((i) => i.approved === true);
const min = Number(kwDoc._meta?.min_approved || 25);
const problems = [];

for (const i of approved) {
  if (!i.slug || !i.keyword) problems.push(`item tanpa keyword/slug: ${JSON.stringify(i)}`);
  if (onDisk.has(i.slug)) problems.push(`"${i.slug}" sudah ada di collection — tabrakan topik, bikin sudut baru atau buang barisnya`);
  if (audit.decisions?.[i.slug]?.action === 'redirect')
    problems.push(`"${i.slug}" adalah slug yang sudah di-redirect 301 — jangan hidupkan lagi`);
  const to = Object.values(audit.decisions || {})
    .filter((d) => d.action === 'redirect')
    .map((d) => String(d.to || '').replace(/^\/blog\/|\/$/g, ''));
  if (to.includes(i.slug))
    problems.push(`"${i.slug}" adalah target kanonik redirect — artikel baru di sini akan menandingi halaman yang barusan kita konsolidasi`);
  if (i.geo && !cityBySlug.has(i.geo))
    problems.push(`geo "${i.geo}" tidak ada di seo/cities.json`);
}

const dupes = approved.map((i) => i.slug).filter((s, n, a) => a.indexOf(s) !== n);
if (dupes.length) problems.push(`slug dobel di keywords.json: ${[...new Set(dupes)].join(', ')}`);

if (problems.length) {
  console.error(`GATE SEED TERTUTUP (${problems.length} masalah):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// ---- 3. Susun queue -------------------------------------------------------
const prev = existsSync(QUEUE_PATH) ? readJson(QUEUE_PATH, 'queue.json (lama)') : null;
const prevBySlug = new Map((prev?.items || []).map((i) => [i.slug, i]));

const mk = (o) => ({ ...o, notes: o.notes ?? '', added_by: o.added_by ?? 'manual' });

const importedItems = live.map((slug) => {
  const raw = readFileSync(join(BLOG_DIR, `${slug}.md`), 'utf8');
  const title = (raw.match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1] || slug;
  const category = (raw.match(/^tags:\s*\[?"?([a-z-]+)/m) || [])[1] || 'panduan';
  return mk({
    keyword: title,
    slug,
    category,
    cluster: category,
    intent: 'impor dari WordPress lama, sudah diaudit Fase 10',
    priority: 50,
    demand_signal: 'imported',
    status: prevBySlug.get(slug)?.status || 'published',
    geo: null,
    added_by: 'impor',
    notes: `audit: ${audit.decisions?.[slug]?.reason || 'keep'} | published di collection`,
  });
});

const keywordItems = approved.map((i) => {
  const city = i.geo ? cityBySlug.get(i.geo) : null;
  return mk({
    keyword: i.keyword,
    slug: i.slug,
    category: i.category,
    cluster: i.cluster,
    intent: i.intent,
    priority: i.priority,
    demand_signal: i.demand_signal,
    status: prevBySlug.get(i.slug)?.status || 'pending',
    geo: i.geo || null,
    city: city?.city || null,
    provinsi: city?.provinsi || null,
    local_anchor: city?.anchor || null,
    local_buyer: city?.buyer || null,
    added_by: city ? 'geo' : 'manual',
    notes: `disetujui ${approvedAt || '(belum)'}`,
  });
});

const items = inventoryOnly ? importedItems : [...importedItems, ...keywordItems];
const queue = {
  _meta: {
    version: '1.0.0',
    generated_by: 'seo/seed-queue.mjs',
    generated_at: new Date().toISOString(),
    keywords_approved_at: approvedAt || null,
    note:
      'JANGAN edit manual berkas ini sebagai sumber topik: sumber topik adalah ' +
      'seo/keywords.json, dan sumber status adalah disk (diperbaiki oleh heal-queue.mjs). ' +
      'Berkas ini hasil join keduanya, jadi ditulis ulang oleh seed-queue.',
    counts: {
      total: items.length,
      published_import: importedItems.length,
      pending_new: inventoryOnly ? 0 : keywordItems.filter((i) => i.status === 'pending').length,
    },
    mode: inventoryOnly ? 'inventory-only (keywords.json belum disetujui)' : 'full',
  },
  items,
};

console.log(
  `seed-queue: ${importedItems.length} post impor published + ` +
    `${inventoryOnly ? 0 : keywordItems.length} keyword ` +
    `(${inventoryOnly ? 'antrean sengaja dikosongkan --inventory-only' : `${queue._meta.counts.pending_new} masih pending`}) = ${items.length} item`,
);

if (dry) {
  console.log('\n--dry: tidak menulis. Contoh 3 item baru:');
  console.log(JSON.stringify(keywordItems.slice(0, 3), null, 2));
  process.exit(0);
}

writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');
console.log(`✓ ditulis ke ${QUEUE_PATH}`);
