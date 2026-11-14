#!/usr/bin/env node
/**
 * seo/rank.mjs — rank tracking per keyword (#19).
 *
 * Menambang posisi GSC (dimensi query), membandingkan dengan snapshot
 * sebelumnya di seo/rank.json, dan alert bila posisi TURUN lebih dari
 * CFG.rankDropAlert (default 3). Posisi = angka lebih besar = lebih buruk,
 * jadi "turun" berarti delta positif (posisi membesar).
 *
 * Tanpa kredensial GSC → tulis {available:false} + exit 0 (skip jujur).
 * Dashboard /traffic membaca readRank(); belum ditambang ≠ posisi 0.
 *
 * main() DIJAGA direct-run: dashboard mengimpor readRank() dari berkas ini,
 * jadi impor tidak boleh ikut menambang. Jalan: node seo/rank.mjs (cron harian).
 * Env: SEO_RANK_PATH · SEO_RANK_DAYS (default 28) · SEO_RANK_DROP · GSC_*.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchAnalytics, loadCreds, SITE_URL } from './lib/gsc.mjs';
import { CFG } from '../runner/lib/config.mjs';
import { sendReport } from '../runner/lib/notify.mjs';
import { openRun } from '../runner/lib/runlog.mjs';
import { NOTIFY_PREFIX } from './site.mjs';
import { ROOT } from './paths.mjs';

export const RANK_PATH = process.env.SEO_RANK_PATH || join(ROOT, 'seo/rank.json');
const DAYS = Number(process.env.SEO_RANK_DAYS || 28);
const log = (m) => console.log(`[rank] ${m}`);

/** Snapshot terakhir untuk dashboard. Tidak pernah melempar. */
export function readRank() {
  try {
    const d = JSON.parse(readFileSync(RANK_PATH, 'utf8'));
    if (!Array.isArray(d.entries)) d.entries = [];
    if (!Array.isArray(d.drops)) d.drops = [];
    if (!Array.isArray(d.improved)) d.improved = [];
    return d;
  } catch {
    return { available: false, reason: 'belum pernah ditambang', generatedAt: null, entries: [], drops: [], improved: [] };
  }
}

function persist(doc) {
  const dir = dirname(RANK_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${RANK_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, RANK_PATH);
}

async function main() {
  const rl = openRun('rank');

  try { loadCreds(); }
  catch (e) {
    log(`GSC belum terpasang — skip: ${e.message}`);
    persist({ available: false, reason: 'GSC credentials belum di-set', generatedAt: new Date().toISOString(), entries: [], drops: [], improved: [] });
    rl.step('creds', 'skip', 'GSC belum di-set');
    rl.finish(0);
    return 0;
  }

  let code = 0;
  try {
    const rows = await searchAnalytics({ days: DAYS, dimensions: ['query'], rowLimit: 200 });
    const prev = readRank();
    const prevMap = new Map((prev.entries || []).map((e) => [e.query, e.position]));

    const entries = rows
      .map((r) => {
        const query = r.keys[0];
        const position = Number((r.position ?? 0).toFixed(2));
        const prevPosition = prevMap.has(query) ? prevMap.get(query) : null;
        const delta = prevPosition != null ? Number((position - prevPosition).toFixed(2)) : null;
        return { query, position, clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: Number((r.ctr ?? 0).toFixed(4)), prevPosition, delta };
      })
      .sort((a, b) => b.clicks - a.clicks || a.position - b.position);

    const drops = entries.filter((e) => e.delta != null && e.delta > CFG.rankDropAlert).sort((a, b) => b.delta - a.delta);
    const improved = entries.filter((e) => e.delta != null && e.delta < -CFG.rankDropAlert).sort((a, b) => a.delta - b.delta);

    persist({
      available: true, generatedAt: new Date().toISOString(), siteUrl: SITE_URL,
      windowDays: DAYS, threshold: CFG.rankDropAlert, total: entries.length, entries, drops, improved,
    });
    log(`${entries.length} query · ${drops.length} turun >${CFG.rankDropAlert} · ${improved.length} naik`);
    rl.step('fetch', 'ok', `${entries.length} query (window ${DAYS} hari)`);
    rl.step('compare', drops.length ? 'warn' : 'ok', `${drops.length} turun, ${improved.length} naik`);

    if (drops.length) {
      await sendReport({
        subject: `[${NOTIFY_PREFIX}] rank — ${drops.length} keyword turun >${CFG.rankDropAlert} posisi`,
        heading: 'SEO engine valleycity.id — rank tracking',
        lines: [
          `Window ${DAYS} hari · ${entries.length} query dilacak`,
          `Ambang alert: turun > ${CFG.rankDropAlert} posisi`,
          ...drops.slice(0, 10).map((e) => `${e.query}: ${e.prevPosition} → ${e.position} (turun ${e.delta})`),
        ],
        alerts: drops.slice(0, 10).map((e) => ({ level: 'warn', msg: `${e.query} turun ${e.delta} posisi (${e.prevPosition}→${e.position})` })),
      });
    }
    rl.summarize({ tracked: entries.length, drops: drops.length, improved: improved.length, windowDays: DAYS });
  } catch (e) {
    log(`GAGAL: ${e.message}`);
    persist({ available: false, reason: e.message, generatedAt: new Date().toISOString(), entries: [], drops: [], improved: [] });
    rl.step('fetch', 'fail', e.message);
    code = 1;
  } finally {
    rl.finish(code);
  }
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((c) => { log(`exit ${c}`); process.exitCode = c; })
    .catch((e) => { console.error(`FATAL: ${e.message}`); process.exitCode = 1; });
}
