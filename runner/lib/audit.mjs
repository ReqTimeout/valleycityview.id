/**
 * runner/lib/audit.mjs — jejak perubahan yang dipicu dari dashboard (#19).
 *
 * Setiap mutasi (generate/publish/inspect/run-daily) dicatat: siapa, kapan,
 * skrip apa, argumen, pid. Ini melengkapi runs.json (yang mencatat hasil
 * pipeline) dengan sisi "siapa yang menekan tombol". Tidak pernah menggagalkan
 * mutasi bila penulisan gagal — sama seperti runlog.
 *
 * Path: SEO_AUDIT_PATH (volume) atau seo/audit-log.json. Artefak runtime.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../../seo/paths.mjs';

export const AUDIT_PATH = process.env.SEO_AUDIT_PATH || join(ROOT, 'seo/audit-log.json');
const KEEP = 300;

function load() {
  try {
    const raw = JSON.parse(readFileSync(AUDIT_PATH, 'utf8'));
    if (!Array.isArray(raw.entries)) raw.entries = [];
    return raw;
  } catch {
    return { _meta: { version: '1.0.0', written_by: 'runner/lib/audit.mjs', keep: KEEP }, entries: [] };
  }
}

function persist(doc) {
  const dir = dirname(AUDIT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${AUDIT_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, AUDIT_PATH);
}

/** entry: { user, action, script, args, pid, note } */
export function logAudit(entry) {
  try {
    const doc = load();
    doc.entries.unshift({ at: new Date().toISOString(), ...entry });
    doc.entries = doc.entries.slice(0, KEEP);
    doc._meta = { ...doc._meta, updatedAt: new Date().toISOString(), keep: KEEP };
    persist(doc);
  } catch (e) {
    console.error(`[audit] GAGAL menulis ${AUDIT_PATH}: ${e.message}`);
  }
}

export function readAudit(limit = 50) {
  try {
    return (load().entries || []).slice(0, limit);
  } catch {
    return [];
  }
}
