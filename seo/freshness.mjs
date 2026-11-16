#!/usr/bin/env node
/**
 * seo/freshness.mjs — pilih & segarkan artikel terbit yang menua (dipanggil
 * runner/weekly.mjs tiap Senin, bisa juga manual).
 *
 * Kebijakan (dibatasi sadar — situs baru, jangan naik-turunkan konten seenaknya):
 * - Kandidat: status publish, umur ≥ FRESH_MIN_AGE_DAYS (30) hari, punya masalah
 *   TERUKUR: tipis (<900 kata) ATAU skor kelengkapan < 70. Tanpa masalah = tidak
 *   disentuh (di sini "segar" berarti ada alasan, bukan ganti-ganti demi tanggal).
 * - Maksimal FRESH_MAX (2) artikel per run + cooldown FRESH_COOLDOWN_DAYS (14)
 *   per slug dari state.freshness — artikel yang baru disegarkan tidak diulang.
 * - Eksekusi per artikel: `node seo/generate.mjs --refresh=<slug>` → pipeline
 *   penuh (prompt, gerbang validateMdx + lint + duplikat + link internal),
 *   status TETAP publish, `updated` = hari ini (lastmod sitemap jujur karena
 *   kontennya memang baru), commit+push, deploy Pages, GSC URL_UPDATED, IndexNow.
 * - Seleksi murni data (inventory kata/skor) — TANPA LLM; hanya eksekusi yang
 *   memakai model (QWEN_MODEL, sama dengan penulisan harian).
 *
 * Jalankan: node seo/freshness.mjs [--dry] [--max N]
 * Output baris terakhir: `freshness: <ok>/<coba> disegarkan` (dipakai weekly).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, STATE_PATH } from './paths.mjs';
import { inventory } from './tracking.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_AGE_DAYS = Number(process.env.FRESH_MIN_AGE_DAYS || 30);
const COOLDOWN_DAYS = Number(process.env.FRESH_COOLDOWN_DAYS || 14);
const THIN_WORDS = 900;
const MIN_SCORE = 70;

function parseArgs(argv) {
  const a = { dry: false, max: Number(process.env.FRESH_MAX || 2) };
  for (const x of argv) {
    if (x === '--dry') a.dry = true;
    else if (x.startsWith('--max=')) a.max = Number(x.slice(6));
  }
  return a;
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}

function ageDays(dateStr) {
  const t = Date.parse(String(dateStr || '').slice(0, 10));
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = readState();
  const refreshed = Array.isArray(state.freshness?.refreshed) ? state.freshness.refreshed : [];
  const cooldownUntil = new Map(
    refreshed.map((r) => [r.slug, Date.parse(r.at || 0) + COOLDOWN_DAYS * 86400000])
  );

  const cand = inventory()
    .published.filter((a) => {
      const age = ageDays(a.date);
      if (age < MIN_AGE_DAYS) return false;
      const until = cooldownUntil.get(a.slug) || 0;
      if (Date.now() < until) return false; // baru disegarkan — istirahat dulu
      return a.words < THIN_WORDS || (a.score ?? 0) < MIN_SCORE;
    })
    .sort((a, b) => (a.words - b.words) || ((a.score ?? 0) - (b.score ?? 0)));

  const pick = cand.slice(0, Math.max(0, args.max));
  if (!pick.length) {
    console.log(`freshness: 0/0 disegarkan — tidak ada kandidat (umur≥${MIN_AGE_DAYS}h, tipis<${THIN_WORDS} kata atau skor<${MIN_SCORE}, cooldown ${COOLDOWN_DAYS} hari)`);
    return 0;
  }
  console.log(`freshness: ${cand.length} kandidat → pilih ${pick.length} (max ${args.max})`);
  for (const c of pick) {
    console.log(`  - ${c.slug} · ${c.words} kata · skor ${c.score} · umur ${ageDays(c.date)} hari`);
  }
  if (args.dry) {
    console.log(`freshness: 0/${pick.length} disegarkan (dry-run)`);
    return 0;
  }

  let ok = 0;
  const done = [];
  for (const c of pick) {
    console.log(`\n=== refresh ${c.slug} ===`);
    const r = spawnSync(process.execPath, [join(HERE, 'generate.mjs'), `--refresh=${c.slug}`], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 150000, // 3 panggilan LLM + template + gates (deploy dkk. ada di dalam)
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const tail = out.trim().split('\n').slice(-4).join(' | ');
    console.log(tail);
    const success = /\b1 ok, 0 fail\b/.test(out);
    if (success) {
      ok++;
      done.push(c.slug);
    }
    // Catat percobaan (juga yang gagal) supaya cooldown menahan retry membabi-buta
    state.freshness = state.freshness || { refreshed: [] };
    state.freshness.refreshed.unshift({
      slug: c.slug, at: new Date().toISOString(),
      wordsBefore: c.words, scoreBefore: c.score, ok: success,
    });
    state.freshness.refreshed = state.freshness.refreshed.slice(0, 60);
  }
  state.freshness.lastRun = new Date().toISOString();
  try { saveState(state); } catch (e) { console.warn(`freshness: gagal catat state (${e.message}) — hasil generate tetap tersimpan`); }

  if (done.length) console.log(`freshness: daftar disegarkan: ${done.join(', ')}`);
  console.log(`freshness: ${ok}/${pick.length} disegarkan`);
  return 0;
}

process.exit(main());
