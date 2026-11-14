#!/usr/bin/env node
/**
 * runner/idle.mjs — proses idle untuk image runner.
 *
 * Coolify memperlakukan application sebagai service: kalau CMD selesai, container
 * di-restart terus-menerus (restart loop) dan `docker exec` jadi berebut dengan poll,
 * dan saling balapan. Scheduled Task di Coolify menjalankan command **di dalam** container
 * aplikasi, jadi container HARUS hidup. Karena itu CMD bawaan adalah idle, bukan
 * pipeline: pipeline dipicu oleh Scheduled Task (`node runner/daily.mjs`).
 *
 * Kalau container ini yang restart-loop, artinya ada yang salah konfigurasi — cek
 * `runner/README.md` (Scheduled Task).
 */

import { startServer } from './lib/http.mjs';

console.log(`[idle] valleycity-seo-runner siap (pid ${process.pid}). Menunggu Scheduled Task.`);
console.log('[idle] task harian: node runner/daily.mjs · mingguan: node runner/weekly.mjs');

// Dashboard HTTP hidup selama container hidup. CMD=idle menjaga container tidak
// restart-loop; server ini yang menyajikan /healthz (probe Coolify) + dashboard.
startServer();

// Inti tetap hidup tanpa busy-loop.
const timer = setInterval(() => {}, 1 << 30);
timer.unref?.();
setInterval(() => {
  // heartbeat ringan tiap 6 jam supaya container terlihat sehat
  console.log(`[idle] heartbeat ${new Date().toISOString()}`);
}, 6 * 60 * 60 * 1000);
