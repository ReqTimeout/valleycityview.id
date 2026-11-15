#!/usr/bin/env node
/**
 * seo/bulk-generate.mjs — wrapper bulk generasi SEMUA artikel dari queue.
 *
 * Mengapa wrapper, bukan --count=694 sekali jalan:
 *   1. Resumable — tiap batch = proses baru; crash/timeout hanya mengulang
 *      batch itu, queue.json sudah tersimpan per artikel oleh generate.mjs.
 *   2. Env panas — proses baru per batch membaca QWEN_API_KEY terbaru, jadi
 *      key bisa dipasang di tengah jalan tanpa memulai ulang.
 *   3. Stop-beruntun — bila N batch berturut-turut gagal 100%, berhenti
 *      (ada masalah sistemik, bukan artikel keberuntungan).
 *
 * Pakai:
 *   node seo/bulk-generate.mjs                 # sampai queue kosong
 *   node seo/bulk-generate.mjs --batch=20      # 20 artikel per proses
 *   node seo/bulk-generate.mjs --limit=100     # berhenti setelah 100 sukses
 *   node seo/bulk-generate.mjs --max-fail=2    # stop bila 2 batch gagal total
 *
 * Log: seo/bulk-gen.log (append). Progress: draft/pending/total tiap batch.
 * Exit: 0 = queue kosong/limit capai; 1 = stop karena gagal beruntun.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { QUEUE_PATH } from './paths.mjs';

// Single-instance: dua wrapper paralel = dua generate.mjs menulis queue.json
// bersamaan = race. Lock file dengan PID; proses mati → lock dibiarkan →
// pid di dalam file dicek hidup/mati.
const LOCK = 'seo/.bulk-gen.lock';
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8').trim());
  try {
    process.kill(pid, 0);
    console.error(`bulk-generate: sudah jalan (pid ${pid}). Matikan dulu: kill ${pid}`);
    process.exit(1);
  } catch {
    unlinkSync(LOCK); // pid sudah mati — lock basi
  }
}
writeFileSync(LOCK, String(process.pid));
const unlock = () => { try { unlinkSync(LOCK); } catch {} };
process.on('exit', unlock);
process.on('SIGINT', () => { unlock(); process.exit(130); });
process.on('SIGTERM', () => { unlock(); process.exit(143); });

const args = process.argv.slice(2);
const num = (flag, d) => {
  const a = args.find((x) => x.startsWith(`${flag}=`));
  return a ? Number(a.slice(flag.length + 1)) : d;
};
const BATCH = Math.max(1, num('--batch', 10));
const LIMIT = num('--limit', Infinity);
const MAX_FAIL = num('--max-fail', 3);

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { items: [] }; }
};

const log = (m) => {
  const line = `[bulk ${new Date().toISOString()}] ${m}`;
  // Hanya tampilkan ke console saat interaktif (TTY). Bila dijalankan via
  // nohup yang me-redirect stdout ke berkas log yang sama, console.log akan
  // menduplikasi tiap baris — jadi cukup tulis berkas sekali di mode itu.
  if (process.stdout.isTTY) console.log(line);
  try { appendFileSync('seo/bulk-gen.log', line + '\n'); } catch {}
};

function counts() {
  const q = readJson(QUEUE_PATH);
  const items = q.items || [];
  const c = { total: items.length, pending: 0, draft: 0, published: 0, defer: 0 };
  for (const i of items) c[i.status === 'deferred' ? 'defer' : i.status] = (c[i.status === 'deferred' ? 'defer' : i.status] || 0) + 1;
  return c;
}

let ok = 0;
let failStreak = 0;
while (ok < LIMIT) {
  const before = counts();
  if (!before.pending) { log(`selesai — pending 0 (draft ${before.draft}, published ${before.published}, defer ${before.defer})`); process.exit(0); }

  log(`batch mulai — pending ${before.pending}, draft ${before.draft}, published ${before.published}`);
  const r = spawnSync(process.execPath, ['seo/generate.mjs', `--count=${BATCH}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: process.env,
  });
  const out = (r.stdout || '').toString().trim().split('\n');
  const tail = out.slice(-6);
  for (const l of tail) console.log(`  | ${l}`);
  const errTail = (r.stderr || '').toString().trim().split('\n').slice(-3);
  for (const l of errTail) console.log(`  ! ${l}`);

  const after = counts();
  const made = after.draft - before.draft;
  const stillPending = after.pending;
  log(`batch selesai — exit ${r.status}, draft baru ${made}, pending sisa ${stillPending}, published ${after.published}`);

  // Batch dinilai dari HASIL (draft dibuat), bukan exit code: generate.mjs
  // exit 1 bila ada 1 artikel gagal walau 7 lain sukses. Pada tingkat sukses
  // ~85-90%, hampir tiap batch exit 1 — memakai exit code akan menghentikan
  // bulk prematur. Hanya batch yang menghasilkan NOL draft dihitung gagal
  // (indikasi masalah sistemik: key/gate), sesuai maksud stop-beruntun.
  if (made > 0) { ok += made; failStreak = 0; }
  else if (!stillPending) { log('selesai — queue kosong'); process.exit(0); }
  else {
    failStreak += 1;
    log(`batch tanpa hasil — streak gagal ${failStreak}/${MAX_FAIL}`);
    if (failStreak >= MAX_FAIL) { log(`STOP — ${MAX_FAIL} batch gagal beruntun. Sisi sistemik: cek LLM key/gate. ${stillPending} pending tersisa.`); process.exit(1); }
  }
}
log(`capai limit ${LIMIT} sukses — stop (masih ada pending, jalankan ulang untuk lanjut)`);
