/**
 * runner/lib/runlog.mjs — jejak tiap kali pipeline dijalankan.
 *
 * Kenapa perlu: tanpa berkas ini, "Runs" hanya bisa menampilkan apa yang masih
 * tersisa di state.json — dan state.json hanya berubah kalau ada yang ditulis.
 * Run yang gagal sebelum sempat menulis apa pun (lock masih dipegang proses lain,
 * kredensial belum ada, gate menutup) persis yang paling perlu dilihat, justru
 * hari berikutnya tidak berubah sama sekali.
 *
 * Aturan:
 * - Menulis log TIDAK BOLEH menggagalkan pipeline. Semua kesalahan dicetak
 *   sebagai peringatan, lalu dilupakan.
 * - Isi = apa yang benar-benar terjadi, termasuk `skip` dan alasannya. Tidak ada
 *   langkah yang ditulis `ok` kalau ia dilewati.
 * - Berkas ini artefak runtime, bukan sumber kebenaran konten; yang lama
 *   dibuang dari ujung (batas di bawah) supaya repo tidak membengkak.
 */

import { appendFileSync } from 'node:fs';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { RUNS_PATH } from '../../seo/paths.mjs';

const KEEP = 200;

function load() {
  try {
    const raw = JSON.parse(readFileSync(RUNS_PATH, 'utf8'));
    if (!Array.isArray(raw.runs)) raw.runs = [];
    return raw;
  } catch {
    return { _meta: { version: '1.0.0', written_by: 'runner/lib/runlog.mjs', keep: KEEP }, runs: [] };
  }
}

function persist(doc) {
  const dir = dirname(RUNS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${RUNS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, RUNS_PATH);
}

/**
 * @param {string} kind 'daily' | 'weekly'
 * @returns {{step:Function, finish:Function, path:string}}
 */
export function openRun(kind) {
  const rec = {
    at: new Date().toISOString(),
    kind,
    pid: process.pid,
    host: hostname(),
    lock: 'acquired',
    steps: [],
    summary: {},
    exit: null,
  };

  const safe = (fn) => {
    try {
      fn();
    } catch (e) {
      // Log gagal tidak boleh menjatuhkan pipeline — tapi jangan diam-diam.
      console.error(`[runlog] GAGAL menulis ${RUNS_PATH}: ${e.message}`);
    }
  };

  const write = () =>
    safe(() => {
      const doc = load();
      // ganti entry yang sama (run yang sedang berjalan) atau sisip di depan
      const i = doc.runs.findIndex((r) => r.at === rec.at && r.kind === rec.kind);
      if (i >= 0) doc.runs[i] = rec;
      else doc.runs.unshift(rec);
      doc.runs = doc.runs.slice(0, KEEP);
      doc._meta = { ...doc._meta, updatedAt: new Date().toISOString(), keep: KEEP };
      persist(doc);
    });

  return {
    path: RUNS_PATH,

    /** status: 'ok' | 'fail' | 'skip' | 'blocked' — note alasan yang terlihat manusia. */
    step(name, status, note = '') {
      rec.steps.push({ name, status, note: String(note).slice(0, 240) });
      write();
    },

    setLock(state, note = '') {
      rec.lock = state;
      if (note) rec.lockNote = String(note).slice(0, 240);
      write();
    },

    /** Angka ringkasan (buildSummary / config) — di-copy supaya historis beku. */
    summarize(obj) {
      rec.summary = { ...rec.summary, ...obj };
      write();
    },

    finish(exit) {
      rec.exit = exit;
      rec.finishedAt = new Date().toISOString();
      write();
    },
  };
}

/** Untuk jalur yang berhenti sebelum sempat membuka run (mis. rebutan lock). */
export function noteOnce(kind, status, note) {
  try {
    const line = `${new Date().toISOString()} ${kind} ${status} ${note}\n`;
    appendFileSync(`${RUNS_PATH}.log`, line);
  } catch {
    /* benar-benar last resort */
  }
}
