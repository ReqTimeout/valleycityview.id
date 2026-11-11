/**
 * runner/lib/lock.mjs — anti double-run tanpa dependency `flock`.
 *
 * Coolify Scheduled Task bisa menumpuk run kalau task sebelumnya masih jalan
 * (deploy lambat, jaringan ngadat). Pakai file lock + flag `wx` (O_EXCL) dan
 * otomatis bersihkan kalau proses pemiliknya sudah tidak ada (stale lock).
 */
import { openSync, closeSync, unlinkSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';

const LOCK_PATH = process.env.SEO_LOCK_PATH || '/tmp/seo-runner.lock';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function processAlive(pid, host) {
  if (host !== hostname()) return true; // lock dibuat di host lain: anggap hidup
  try {
    process.kill(pid, 0); // signal 0 = cek keberadaan, tidak men-kill
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} name nama job, mis. 'daily'
 * @param {{timeoutMs?: number, pollMs?: number}} [opts]
 * @returns {Promise<{acquired: boolean, holder: object|null, release: () => void}>}
 */
export async function acquireLock(name, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const pollMs = opts.pollMs ?? 3000;
  const started = Date.now();

  for (;;) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      const payload = JSON.stringify({ name, pid: process.pid, host: hostname(), at: new Date().toISOString() });
      writeFileSync(fd, payload);
      closeSync(fd);
      let released = false;
      return {
        acquired: true,
        holder: JSON.parse(payload),
        release() {
          if (released) return;
          released = true;
          try {
            unlinkSync(LOCK_PATH);
          } catch {
            /* sudah hilang */
          }
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;

      let holder = null;
      try {
        holder = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
      } catch {
        holder = null;
      }

      // Stale lock (pemilik mati) → bersihkan lalu coba lagi.
      if (holder && !processAlive(holder.pid, holder.host)) {
        try {
          unlinkSync(LOCK_PATH);
        } catch {
          /* race dengan proses lain */
        }
        continue;
      }

      if (Date.now() - started > timeoutMs) {
        return { acquired: false, holder, release() {} };
      }
      await sleep(pollMs);
    }
  }
}

/** Isi lock sekarang (untuk log/debug), null kalau tidak ada. */
export function lockStatus() {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return { corrupt: true, path: LOCK_PATH };
  }
}
