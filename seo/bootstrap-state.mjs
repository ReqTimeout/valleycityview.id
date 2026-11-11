#!/usr/bin/env node
/**
 * seo/bootstrap-state.mjs — S0: bootstrap `seo/state.json` deterministik (0 AI).
 *
 * Kenapa: `state.json` hilang di mesin lokal (bekas mesin lama). Indexer (Fase C/D)
 * dan IndexNow dedup butuh state ini. Kalau mulai dari nol buta, runner akan
 * re-submit ulang artikel lama yang sudah ter-index (boros kuota + noise).
 *
 * Strategi: bangun dari `queue.json` status `published` yang file Markdown-nya benar-benar
 * ada di BLOG_DIR dan TIDAK draft. Prefill `indexnow.submitted` dengan URL-nya supaya
 * IndexNow tidak ping ulang yang sudah live.
 *
 * Default TIDAK menimpa state.json yang sudah ada (aman untuk re-run). Pakai --force
 * untuk rebuild dari nol, --dry untuk preview.
 *
 * Usage:
 *   node seo/bootstrap-state.mjs [--dry] [--force]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { BLOG_DIR, QUEUE_PATH, STATE_PATH } from './paths.mjs';

const SITE = 'https://valleycity.id';
const opts = { dry: process.argv.includes('--dry'), force: process.argv.includes('--force') };

if (existsSync(STATE_PATH) && !opts.force) {
  console.log(`state.json SUDAH ADA di ${STATE_PATH} — tidak ditimpa (pakai --force untuk rebuild).`);
  process.exit(0);
}

const queue = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
const items = queue.items || [];

// Verifikasi: published di queue + file Markdown ada + bukan draft.
const published = [];
for (const it of items) {
  if (it.status !== 'published') continue;
  const slug = it.slug;
  if (!slug) continue;
  const file = join(BLOG_DIR, `${slug}.md`);
  if (!existsSync(file)) {
    console.log(`  skip "${slug}": status published tapi Markdown tidak ada`);
    continue;
  }
  const raw = readFileSync(file, 'utf8');
  if (raw.includes('\nstatus: draft')) {
    console.log(`  skip "${slug}": Markdown masih draft`);
    continue;
  }
  const pubMatch = raw.match(/^date:\s*"?([0-9T:.\-+ ]+)/m);
  published.push({
    slug,
    url: `${SITE}/blog/${slug}/`,
    firstSeen: pubMatch ? pubMatch[1].trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
    indexed: 'unknown',
    lastChecked: null,
  });
}

const today = new Date().toISOString();
const state = {
  _meta: {
    bootstrapped_at: today,
    source: 'bootstrap-state.mjs (deterministic from queue published + Markdown on disk)',
    count: published.length,
  },
  published,
  indexnow: {
    submitted: published.map((p) => p.url),
    last: null,
  },
};

console.log(`Bootstrap state.json: ${published.length} artikel published terverifikasi.`);
console.log('  URL:', published.map((p) => p.slug).join(', ') || '(kosong)');

if (opts.dry) {
  console.log('\n--dry: tidak menulis file. Preview:');
  console.log(JSON.stringify(state, null, 2));
  process.exit(0);
}

writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
console.log(`\n✓ Ditulis ke ${STATE_PATH} (indexnow.submitted diprefill ${published.length} URL).`);
