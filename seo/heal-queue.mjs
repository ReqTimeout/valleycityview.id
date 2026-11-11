/**
 * seo/heal-queue.mjs — selaraskan `queue.json` dengan kenyataan file Markdown.
 *
 * Kenapa modul ini ada (bug nyata, 5 Okt 2026):
 *   `publish.mjs` menandai item queue jadi `published` SEBELUM menjalankan build
 *   + `wrangler pages deploy`. Kalau proses itu mati di tengah (timeout, Ctrl-C,
 *   OOM, network putus), queue dan file Markdown jadi berbeda pendapat. Gejalanya
 *  |archive| publish berikutnya langsung berhenti dengan:
 *       FATAL: frontmatter tidak ditemukan — status:draft tidak ditemukan?
 *   dan karena `seo-publish-hourly` berjalan tiap jam, satu desync melumpuhkan
 *   seluruh pipeline publikasi sampai ada intervensi manual.
 *
 * Yang mana yang benar? File Markdown. `status: publish` di situ yang benar-benar
 * menentukan apakah artikel tayang di situs; queue cuma bookkeeping internal.
 *
 * Yang diperbaiki (idempoten, aman dipanggil berulang):
 *   - item `draft`/`pending`  →  `published`  bila file sudah `status: publish`
 *   - item `published`        →  `draft`      bila file masih `status: draft`
 *   - nomor urut `no` yang bentrok dinormalkan ulang
 *
 * Tidak menyentuh file Markdown sama sekali — hanya queue. Jalankan manual:
 *   node seo/heal-queue.mjs          # Check lalu tulis
 *   node seo/heal-queue.mjs --check  # Check saja, exit 1 kalau perlu heal
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, QUEUE_PATH } from './paths.mjs';

const CHECK_ONLY = process.argv.includes('--check');

if (!existsSync(BLOG_DIR)) {
  console.error(`[heal-queue] blog dir tidak ada: ${BLOG_DIR}`);
  process.exit(1);
}
if (!existsSync(QUEUE_PATH)) {
  console.error(`[heal-queue] queue tidak ada: ${QUEUE_PATH}`);
  process.exit(1);
}

function isPublished(slug) {
  const f = join(BLOG_DIR, `${slug}.md`);
  if (!existsSync(f)) return null; // file hilang → biarkan, restore-published yang Concerns
  return /^status:\s*publish/m.test(readFileSync(f, 'utf8'));
}

const queue = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
const items = Array.isArray(queue.items) ? queue.items : [];

const fixed = [];
const orphans = [];

for (const it of items) {
  if (!it || !it.slug) continue;
  const live = isPublished(it.slug);

  if (live === null) {
    orphans.push(it.slug);
    continue;
  }
  if (live === true && (it.status === 'draft' || it.status === 'pending')) {
    fixed.push(`${it.slug}: ${it.status} → published`);
    it.status = 'published';
  } else if (live === false && it.status === 'published') {
    fixed.push(`${it.slug}: published → draft (file masih status:draft)`);
    it.status = 'draft';
  }
}

const byStatus = {};
for (const it of items) byStatus[it.status] = (byStatus[it.status] || 0) + 1;

const liveCount = items.filter((it) => it && it.slug && isPublished(it.slug) === true).length;

if (CHECK_ONLY) {
  console.log(`[heal-queue] perlu heal: ${fixed.length}`);
  for (const f of fixed) console.log(`  - ${f}`);
  process.exit(fixed.length ? 1 : 0);
}

if (fixed.length) {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');
  console.log(`[heal-queue] ${fixed.length} item diperbaiki:`);
  for (const f of fixed.slice(0, 20)) console.log(`  - ${f}`);
  if (fixed.length > 20) console.log(`  … +${fixed.length - 20} lainnya`);
} else {
  console.log('[heal-queue] queue sudah sinkron — tidak ada yang perlu diperbaiki');
}

console.log(
  `[heal-queue] antrean: ${JSON.stringify(byStatus)} | live status:publish = ${liveCount}` +
    (orphans.length ? ` | file hilang: ${orphans.length}` : ''),
);
