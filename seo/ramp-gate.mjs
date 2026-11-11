#!/usr/bin/env node
/**
 * seo/ramp-gate.mjs — hitung index_rate lalu set `seo/config.json` daily_count (plan v2 §3).
 *
 * Dijalankan mingguan (Senin) oleh runner sebelum publish. Tujuannya: tidak
 * menaikkan volume publish kalau Google tidak mengindeks hasil publish
 * sebelumnya (anti scaled-content-abuse, plan §9).
 *
 * ═══ ATURAN PENTING (revisi 1 Okt 2026, lihat plan §14.4) ═══
 * `index_rate` dihitung sebagai `indexed / discovered`, BUKAN `indexed / published`.
 * URL berlabel `not_discovered` ("URL is unknown to Google") **dikecualikan**:
 * Google belum pernah melihat URL itu, jadi itu masalah DISCOVERY (sitemap,
 * internal link) — bukan masalah kualitas konten. Kalau ikut dihitung, rate
 * plummet selama 1-3 hari pertama setelah sitemap baru disubmit dan
 * `daily_count` jatuh ke floor 1 → plan berhenti total.
 * URL `not_discovered` memicu `discovery_alert`, bukan penalti ramp.
 *
 * Ramp:
 *   index_rate >= 85%          → daily_count += 2   (cap daily_count_max)
 *   70% <= index_rate < 85%    → hold
 *   index_rate < 70%           → daily_count -= 1   (floor daily_count_min) + quality_alert
 *   sample < min_sample        → hold (insufficient_sample, jangan menilai dengan data tipis)
 *   discovery_gap >= 50%       → hold + discovery_alert (perbaiki discovery dulu)
 *   halt: true                 → daily_count = 0 (butuh reset manual; mis. manual action GSC)
 *
 * Membaca label dari `state.json` → `gsc.inspections[url].coverageState`/verdict,
 * hasil written oleh `seo/gsc-inspect.mjs` (label disimpan juga di `published[].indexed`).
 *
 * Usage:
 *   node seo/ramp-gate.mjs              # hitung + tulis config.json
 *   node seo/ramp-gate.mjs --dry-run    # hitung, tidak tulis
 *   node seo/ramp-gate.mjs --window 28  # window index_rate (default dari config: 14)
 *   node seo/ramp-gate.mjs --set 2      # override manual daily_count (motor: "manual-override")
 *   node seo/ramp-gate.mjs --halt "manual action GSC"   # stop publish total
 *   node seo/ramp-gate.mjs --reset      # lift halt, kembali hitung otomatis
 *   node seo/ramp-gate.mjs --json       # output JSON saja (untuk notifikasi/email)
 *
 * Exit: 0 = ok (alert tetap exit 0 — alert bukan crash), 1 = gagal (config/state rusak).
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_PATH, CONFIG_PATH as CONFIG_DEFAULT } from './paths.mjs';

const STATE = process.env.SEO_STATE_PATH || STATE_PATH;
const CONFIG = process.env.SEO_CONFIG_PATH || CONFIG_DEFAULT;

function parseArgs(argv) {
  const args = { dryRun: false, json: false, window: null, set: null, halt: null, reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else if (a === '--reset') args.reset = true;
    else if (a === '--window') args.window = Number(argv[++i]);
    else if (a === '--set') args.set = Number(argv[++i]);
    else if (a === '--halt') args.halt = argv[++i] || 'manual';
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} tidak ada: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

/** Samakan logika label dengan seo/gsc-inspect.mjs (label() di sana). */
function labelFrom(entry, publishedLabel) {
  if (publishedLabel) return publishedLabel;
  if (!entry) return 'unknown';
  const coverage = String(entry.coverageState || '');
  if (entry.robotsTxtState === 'DISALLOWED') return 'blocked';
  if (entry.verdict === 'PASS' && /indexed/i.test(coverage) && !/not indexed/i.test(coverage)) return 'indexed';
  if (/excluded|blocked/i.test(coverage)) return 'blocked';
  if (/unknown to Google/i.test(coverage)) return 'not_discovered';
  if (/not indexed/i.test(coverage)) return 'not_indexed';
  return 'unknown';
}

function computeMetrics(state, windowDays) {
  const inspections = state.gsc?.inspections || {};
  const published = state.published || [];
  const cutoff = Date.now() - windowDays * 86400000;

  const buckets = { indexed: 0, not_indexed: 0, not_discovered: 0, blocked: 0, unknown: 0 };
  const inWindow = [];

  for (const p of published) {
    const entry = inspections[p.url];
    // Hanya URL yang benar-benar dicek dalam window yang dihitung (state bisa
    // berisi inspeksi lama yang sudah lewat window).
    if (entry?.checkedAt && Date.parse(entry.checkedAt) < cutoff) continue;
    const label = labelFrom(entry, p.indexed);
    buckets[label] = (buckets[label] || 0) + 1;
    inWindow.push({ url: p.url, label });
  }

  const total = inWindow.length;
  // `discovered` = Google punya data tentang URL (bukan "unknown to Google").
  // Ini penyebut index_rate. Exclude not_discovered + unknown.
  const discovered = buckets.indexed + buckets.not_indexed + buckets.blocked;
  const indexRate = discovered > 0 ? buckets.indexed / discovered : null;
  const discoveryGapRatio = total > 0 ? (buckets.not_discovered + buckets.unknown) / total : null;

  return { total, discovered, indexRate, discoveryGapRatio, buckets, inWindow };
}

function decide(metrics, config, mode) {
  const prev = config.daily_count;
  const min = config.daily_count_min ?? 1;
  const max = config.daily_count_max ?? 10;
  const minSample = config.min_sample ?? 5;
  const up = config.threshold_up ?? 0.85;
  const down = config.threshold_down ?? 0.7;
  const gapAlert = config.discovery_gap_alert ?? 0.5;
  const alerts = [];

  const out = { next: prev, reason: '', alerts, mode };
  const clamp = (n) => Math.max(min, Math.min(max, n));

  if (config.halt) {
    out.next = 0;
    out.reason = `HALT aktif: ${config.halt_reason || 'tanpa alasan'}`;
    alerts.push({ level: 'critical', code: 'halt', msg: out.reason });
    return out;
  }

  if (mode === 'manual-override') {
    out.reason = 'manual override (--set)';
    return out;
  }

  const { total, discovered, indexRate, discoveryGapRatio, buckets } = metrics;

  if (total === 0) {
    out.reason = 'hold — belum ada URL ter-inspect di window ini';
    alerts.push({ level: 'warn', code: 'no_data', msg: out.reason });
    return out;
  }

  if (discoveryGapRatio !== null && discoveryGapRatio >= gapAlert) {
    out.reason = `hold — discovery gap ${(discoveryGapRatio * 100).toFixed(0)}% (${buckets.not_discovered} not_discovered / ${total})`;
    alerts.push({
      level: 'warn',
      code: 'discovery_gap',
      msg: `Google belum menemukan ${buckets.not_discovered}/${total} URL. Perbaiki discovery (sitemap GSC + internal link money→blog) BUKAN turunkan volume publish.`,
    });
    return out;
  }

  if (discovered < minSample) {
    out.reason = `hold — sample tipis (discovered ${discovered} < min_sample ${minSample})`;
    alerts.push({ level: 'warn', code: 'insufficient_sample', msg: out.reason });
    return out;
  }

  if (indexRate >= up) {
    out.next = clamp(prev + 2);
    out.reason = `naik — index_rate ${(indexRate * 100).toFixed(1)}% >= ${up * 100}% (${prev} → ${out.next})`;
    return out;
  }
  if (indexRate >= down) {
    out.reason = `hold — index_rate ${(indexRate * 100).toFixed(1)}% di band aman ${down * 100}-${up * 100}%`;
    return out;
  }
  out.next = clamp(prev - 1);
  out.reason = `turun — index_rate ${(indexRate * 100).toFixed(1)}% < ${down * 100}% (${prev} → ${out.next})`;
  alerts.push({
    level: 'critical',
    code: 'quality_drop',
    msg: `Index rate ${(indexRate * 100).toFixed(1)}% (${buckets.indexed}/${buckets.not_indexed + buckets.indexed + buckets.blocked}) di bawah ambang. Turunkan volume + periksa isi artikel.`,
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        'Usage: node seo/ramp-gate.mjs [--dry-run] [--window N] [--set N] [--halt "alasan"] [--reset] [--json]',
        '  --dry-run   hitung + tampilkan, tidak menulis config.json',
        '  --set N     override manual daily_count',
        '  --halt R    stop publish (daily_count 0) sampai --reset',
        '  --reset     lift halt',
      ].join('\n')
    );
    return 0;
  }

  const state = readJson(STATE, 'state.json');
  const config = readJson(CONFIG, 'config.json');
  const windowDays = args.window || config.index_window_days || 14;

  if (args.reset) {
    config.halt = false;
    config.halt_reason = '';
    config.updated_at = new Date().toISOString();
    config.updated_by = 'ramp-gate.mjs --reset';
    if (!args.dryRun) writeJsonAtomic(CONFIG, config);
    if (!args.json) console.log(`ramp-gate: halt dilift${args.dryRun ? ' (dry-run, tidak ditulis)' : ''}`);
    return 0;
  }

  const metrics = computeMetrics(state, windowDays);

  let mode = 'auto';
  if (args.halt !== null) {
    config.halt = true;
    config.halt_reason = args.halt;
    mode = 'halt';
  } else if (args.set !== null) {
    if (Number.isNaN(args.set)) throw new Error('--set harus angka');
    config.daily_count = Math.max(0, Math.min(config.daily_count_max ?? 10, args.set));
    mode = 'manual-override';
  }

  const decision = decide(metrics, config, mode);

  const history = Array.isArray(config.history) ? config.history : [];
  const entry = {
    at: new Date().toISOString(),
    previous_daily_count: config.daily_count,
    daily_count: decision.next,
    reason: decision.reason,
    window_days: windowDays,
    metrics: {
      total: metrics.total,
      discovered: metrics.discovered,
      indexed: metrics.buckets.indexed,
      not_indexed: metrics.buckets.not_indexed,
      not_discovered: metrics.buckets.not_discovered,
      blocked: metrics.buckets.blocked,
      unknown: metrics.buckets.unknown,
      index_rate: metrics.indexRate === null ? null : Number(metrics.indexRate.toFixed(4)),
      discovery_gap_ratio:
        metrics.discoveryGapRatio === null ? null : Number(metrics.discoveryGapRatio.toFixed(4)),
    },
    alerts: decision.alerts.map((a) => a.code),
  };
  history.push(entry);
  while (history.length > 30) history.shift();

  config.daily_count = decision.next;
  config.updated_at = entry.at;
  config.updated_by = `ramp-gate.mjs (${mode})`;
  config.reason = decision.reason;
  config.history = history;

  // Simpan alert ke state.json supaya notify.mjs (runner) bisa kirim email.
  state.rampGate = { lastRun: entry, alert: decision.alerts[0] || null };
  if (!args.dryRun) {
    writeJsonAtomic(CONFIG, config);
    writeJsonAtomic(STATE, state);
  }

  if (args.json) {
    console.log(JSON.stringify({ metrics: entry.metrics, decision: entry }, null, 2));
    return 0;
  }

  const { buckets, indexRate, discoveryGapRatio, discovered, total } = metrics;
  console.log(`ramp-gate — window ${windowDays} hari${args.dryRun ? ' (DRY-RUN)' : ''}\n`);
  console.log(`  URL di window      : ${total}`);
  console.log(`  indexed            : ${buckets.indexed}`);
  console.log(`  not_indexed        : ${buckets.not_indexed}`);
  console.log(`  blocked            : ${buckets.blocked}`);
  console.log(`  not_discovered     : ${buckets.not_discovered}  (excluded dari rate)`);
  console.log(`  unknown            : ${buckets.unknown}  (excluded dari rate)`);
  console.log(`  index_rate         : ${indexRate === null ? 'n/a' : `${(indexRate * 100).toFixed(1)}%`} (indexed / discovered=${discovered})`);
  console.log(`  discovery gap      : ${discoveryGapRatio === null ? 'n/a' : `${(discoveryGapRatio * 100).toFixed(1)}%`}\n`);
  console.log(`  daily_count        : ${entry.previous_daily_count} → ${entry.daily_count}`);
  console.log(`  alasan             : ${entry.reason}`);
  for (const a of decision.alerts) console.log(`  [${a.level.toUpperCase()}] ${a.msg}`);
  if (args.dryRun) console.log('\n(--dry-run: config.json & state.json tidak ditulis)');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error('FATAL:', e.message);
    process.exitCode = 1;
  });
