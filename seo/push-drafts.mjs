#!/usr/bin/env node
/**
 * seo/push-drafts.mjs — commit draft yang baru dihasilkan ke repo ini.
 *
 * Di socio.id script ini mendorong draft ke REPO KONTEN TERPISAH, dengan guard
 * "jangan sampai ter-push ke repo app karena memicu deploy". Di valleycityview
 * tidak ada repo konten: blog collection hidup di repo yang sama, dan draft
 * (`status: draft`) memang tidak dirender — getStaticPaths hanya mengambil
 * `status === 'publish'`. Jadi mendorong draft aman untuk produksi, dan itu
 * justru satu-satunya cara state mesin ikut versi-terkontrol.
 *
 * Yang berubah dari versi aslinya:
 * - guard nama repo dibuang, diganti gerbang audit Fase 10 langkah 0:
 *   selama 71 post lama belum seluruhnya diputuskan, tidak ada draft baru.
 * - default hanya commit; push butuh `--push` eksplisit. Mesin tidak boleh
 *   mengirim kode ke remote tanpa diminta.
 * - `git pull --rebase` tetap: satu writer per field, hindari konflik queue.
 *
 * Usage: node seo/push-drafts.mjs [--dry] [--push] [--message="..."]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  BLOG_DIR,
  QUEUE_PATH,
  STATE_PATH,
  AUDIT_GATE_PATH,
} from './paths.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const doPush = args.includes('--push');
const msgArg = args.find((a) => a.startsWith('--message='));

function git(argv) {
  return execFileSync('git', argv, { encoding: 'utf8' }).trim();
}

if (!existsSync(BLOG_DIR)) {
  console.error(`FATAL: BLOG_DIR tidak ada: ${BLOG_DIR}`);
  process.exit(1);
}

// ---- Gerbang Fase 10 langkah 0 -------------------------------------------
// Tidak ada draft baru sebelum audit 71 post lama beres. Ini digardai di sini,
// bukan hanya "diharapkan" di dokumentasi.
if (!existsSync(AUDIT_GATE_PATH)) {
  console.error(`FATAL: gerbang audit tidak ada: ${AUDIT_GATE_PATH}`);
  process.exit(1);
}
const gate = spawnSync(process.execPath, [AUDIT_GATE_PATH], { encoding: 'utf8' });
if (gate.status !== 0) {
  console.error('FATAL: gerbang audit 71 post belum terbuka — tidak ada draft baru.');
  console.error((gate.stderr || gate.stdout || '').split('\n').filter(Boolean).slice(-4).join('\n'));
  process.exit(1);
}

const root = git(['rev-parse', '--show-toplevel']);
console.log(`Repo root: ${root}`);

let dirty = '';
try {
  git(['pull', '--rebase', '--autostash']);
  console.log('✓ pull --rebase --autostash');
} catch {
  console.error('FATAL: pull --rebase gagal (konflik?). Selesaikan manual sebelum push draft.');
  process.exit(1);
}

// ---- stage: hanya draft + berkas state mesin ------------------------------
const draftFiles = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.md'))
  .filter((f) => /^status:\s*draft\s*$/m.test(readFileSync(join(BLOG_DIR, f), 'utf8')))
  .map((f) => join(BLOG_DIR, f).slice(root.length + 1));

const stateFiles = [QUEUE_PATH, STATE_PATH]
  .filter((p) => existsSync(p))
  .map((p) => p.slice(root.length + 1));

if (!draftFiles.length && !stateFiles.length) {
  console.log('Tidak ada draft baru. Bersih.');
  process.exit(0);
}

git(['add', '--', ...draftFiles, ...stateFiles]);
dirty = git(['diff', '--cached', '--name-only']);
if (!dirty) {
  console.log('Draft sudah ter-commit sebelumnya. Tidak ada yang baru.');
  process.exit(0);
}

const files = dirty.split('\n').filter(Boolean);
console.log(`Siap commit ${files.length} berkas (${draftFiles.length} draft):`);
for (const f of files) console.log('  ' + f);

const message =
  msgArg && msgArg.slice('--message='.length)
    ? msgArg.slice('--message='.length)
    : `content(seo): ${draftFiles.length} draft + state mesin (${new Date().toISOString().slice(0, 10)})`;

if (dry) {
  console.log(`\n--dry: tidak commit. Pesan akan: "${message}"`);
  git(['reset', 'HEAD', '--quiet']);
  process.exit(0);
}

git(['commit', '-m', message]);
console.log('✓ commit');

if (!doPush) {
  console.log('Draft di-commit lokal. Tambah --push untuk mengirim ke remote.');
  process.exit(0);
}

git(['push', 'origin', 'HEAD']);
console.log('✓ push');
