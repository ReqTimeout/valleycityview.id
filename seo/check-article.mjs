#!/usr/bin/env node
/**
 * seo/check-article.mjs — CLI validasi artikel (tipis).
 *
 * SEMUA logika ada di `seo/lib/article-lint.mjs`. File ini cuma lapisan CLI.
 * Dipisah karena 4 Okt 2026: logika ini tinggal di sini sebagai skrip manual,
 * tidak pernah dipanggil `generate.mjs`, sehingga artikel cacat tetap masuk korpus.
 * Sekarang `generate.mjs` memanggil `lintArticle()` yang sama.
 *
 * Pakai: node seo/check-article.mjs <slug> [<slug> ...]
 * Uji gate: node seo/lib/article-lint.mjs --self-test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR } from './paths.mjs';
import { lintArticle, yamlTersedia } from './lib/article-lint.mjs';

const slugs = process.argv.slice(2);
if (!slugs.length) {
  console.error('Pakai: node seo/check-article.mjs <slug> [<slug> ...]');
  process.exit(2);
}

if (!yamlTersedia()) {
  console.error('  PERINGATAN: js-yaml tidak ketemu — validasi sintaks YAML dilewati.');
}

let gagal = 0;

for (const slug of slugs) {
  const f = join(BLOG_DIR, `${slug}.md`);
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    console.log(`  ✗ ${slug}: file tidak ada`);
    gagal++;
    continue;
  }

  const { err, info } = lintArticle(src);
  if (err.length) {
    gagal++;
    console.log(`  ✗ ${slug}`);
    for (const e of err) console.log(`      - ${e}`);
  } else {
    console.log(`  ✓ ${slug}  (draft=${info.draft}, ${info.faq} FAQ, ${info.token} token)`);
  }
}

console.log(gagal ? `\n  ${gagal} artikel belum benar` : `\n  semua ${slugs.length} artikel valid`);
process.exitCode = gagal ? 1 : 0;
