#!/usr/bin/env node
/**
 * Fase 10 langkah 0 — gerbang pra-kondisi mesin SEO.
 *
 * Mengaudit 71 post impor (src/collections/blog/*.md) SEBELUM satu artikel
 * baru dihasilkan. Yang dicari, sesuai plan:
 *   (a) duplikat topik        — post yang bersaing di query yang sama
 *   (b) tidak ada nilai informasinya — thin / whole-body template residue
 *   (c) sisa kerangka template — badan artikel disusun ulang dari kalimat
 *       yang sama persis dengan post lain (boilerplate impor)
 * Post kategori (b) di-noindex atau di-redirect, bukan ditambahi tetangga
 * baru.
 *
 * Keputusan final hidup di ../audit/posts.json:
 *   { "decisions": { "<slug>": { "action": "keep" | "noindex" | "redirect",
 *                                "to": "/blog/<slug>/" (wajib utk redirect),
 *                                "reason": "..." } } }
 *
 * Exit code:
 *   1 — belum ada keputusan untuk semua post (gate belum dibuka), ATAU
 *       keputusan tidak konsisten dengan frontmatter/_redirects.
 *   2 — ada post yang terdeteksi thin/boilerplate-100% tapi di-keep tanpa
 *       alasan (kasus ekstrem harus diputuskan eksplisit).
 *
 * Tanpa flags: cetak laporan + tabel keputusan + exit sesuai di atas.
 *   --suggest  tulis draf posts.json (semua "keep" + alasan deteksi) untuk
 *              direview manusia — TIDAK mengubah file apa pun selain itu.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..');
const repoRoot = join(siteRoot, '..');
const blogDir = join(siteRoot, 'src/collections/blog');
const decisionsPath = join(repoRoot, 'audit/posts.json');
const redirectsPath = join(siteRoot, 'dist/_redirects');

// ---------------------------------------------------------------- parsing
const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function parsePost(file) {
  const raw = readFileSync(join(blogDir, file), 'utf8');
  const m = raw.match(FM_RE);
  const data = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
      if (kv) data[kv[1]] = kv[2];
    }
  }
  const body = m ? raw.slice(m[0].length) : raw;
  return { file, data, body, raw };
}

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ');
const norm = (s) => stripTags(s).replace(/\s+/g, ' ').trim();
const words = (s) => (norm(s).match(/\S+/g) ?? []).length;

/** Split body into blocks (p, li, h2…), used for boilerplate comparison. */
function blocks(body) {
  return (body.match(/<(p|li|h2|h3)[^>]*>[\s\S]*?<\/\1>/g) ?? [])
    .map(norm)
    .filter((t) => t.length >= 40); // ignore short nav-ish text
}

const STOP = new Set(
  ('yang dan di ke untuk dengan dari pada dalam atau ini itu serta agar ' +
    'sebagai terhadap oleh secara juga sudah bisa akan tidak lebih sangat ' +
    'anda kami kita mereka nya di mana kapan bagaimana apa siapa').split(' '),
);
const keyTokens = (title) =>
  new Set(
    norm(title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .split(' ')
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
const jaccard = (a, b) => {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
};

// ---------------------------------------------------------------- metrics
const posts = readdirSync(blogDir).filter((f) => f.endsWith('.md')).map(parsePost);
posts.sort((a, b) => (a.data.slug ?? a.file).localeCompare(b.data.slug ?? b.file));

// Sentence frequency across posts → boilerplate = sentence present in >=3
// OTHER posts (imported tails/leads reused verbatim).
const postSeen = posts.map((p) => new Set(blocks(p.body)));
const sentFreq = new Map();
for (const seen of postSeen)
  for (const b of seen) sentFreq.set(b, (sentFreq.get(b) ?? 0) + 1);

const metrics = posts.map((p, i) => {
  const own = postSeen[i];
  let boiler = 0;
  for (const b of own) if ((sentFreq.get(b) ?? 0) >= 3) boiler++;
  const dupTitle = [];
  const ti = keyTokens(p.data.title ?? '');
  for (let j = 0; j < posts.length; j++) {
    if (j === i) continue;
    if (jaccard(ti, keyTokens(posts[j].data.title ?? '')) >= 0.5)
      dupTitle.push(posts[j].data.slug);
  }
  const wc = words(p.body);
  const boilerRatio = own.size ? boiler / own.size : 1;
  return {
    slug: p.data.slug ?? p.file.replace(/\.md$/, ''),
    file: p.file,
    data: p.data,
    raw: p.raw,
    wc,
    blocks: own.size,
    boilerRatio,
    dupTitle,
  };
});

// ---------------------------------------------------------------- classify
function detect(m) {
  const reasons = [];
  if (m.wc < 350) reasons.push(`thin: ${m.wc} kata`);
  if (m.boilerRatio >= 0.999 && m.blocks > 0) reasons.push('body 100% boilerplate impor');
  else if (m.boilerRatio >= 0.5) reasons.push(`sisa kerangka: ${Math.round(m.boilerRatio * 100)}% badan = kalimat post lain`);
  if (m.dupTitle.length) reasons.push(`duplikat topik dengan: ${m.dupTitle.join(', ')}`);
  if (!reasons.length) return null;
  const severe = m.wc < 350 || m.boilerRatio >= 0.999;
  return { action: severe ? 'noindex-candidate' : 'review', reasons };
}

const findings = metrics.map((m) => ({ ...m, detect: detect(m) }));

// ---------------------------------------------------------------- report
const flagged = findings.filter((f) => f.detect);
console.log(`audit-posts: ${findings.length} post, ${flagged.length} butuh keputusan\n`);
for (const f of findings) {
  const tag = f.detect ? `[${f.detect.action}]` : '[ok]';
  console.log(
    `${tag.padEnd(18)} ${f.slug}  (${f.wc}w, ${Math.round(f.boilerRatio * 100)}% boiler)`,
  );
  if (f.detect) for (const r of f.detect.reasons) console.log(`    · ${r}`);
}

// ---------------------------------------------------------------- --suggest
if (process.argv.includes('--suggest')) {
  mkdirSync(dirname(decisionsPath), { recursive: true });
  const decisions = {};
  for (const f of findings) {
    decisions[f.slug] = f.detect
      ? { action: 'keep', reason: 'DRAF: ' + f.detect.reasons.join('; ') }
      : { action: 'keep', reason: 'tidak ada temuan deteksi' };
  }
  writeFileSync(decisionsPath, JSON.stringify({ _note: 'DRAF audit Fase 10 langkah 0 — review tiap keep sebelum gate dibuka.', decisions }, null, 2) + '\n');
  console.log(`\nDraf ditulis: ${decisionsPath}\nReview, ubah action sesuai keputusan editorial, lalu jalankan ulang tanpa --suggest untuk menutup gate.`);
  process.exit(0);
}

// ---------------------------------------------------------------- gate
if (!existsSync(decisionsPath)) {
  console.error(`\nGATE: ${decisionsPath} belum ada — tidak ada post baru sebelum 71 post lama diputuskan.`);
  process.exit(1);
}
const { decisions } = JSON.parse(readFileSync(decisionsPath, 'utf8'));
let gateFail = false;
const missing = findings.filter((f) => !decisions[f.slug]);
if (missing.length) {
  console.error(`GATE: ${missing.length} post belum punya keputusan: ${missing.map((m) => m.slug).join(', ')}`);
  gateFail = true;
}

// consistency checks against actual files
let redirectRules = '';
if (existsSync(redirectsPath)) redirectRules = readFileSync(redirectsPath, 'utf8');
const bySlug = new Map(findings.map((f) => [f.slug, f]));
for (const f of findings) {
  const d = decisions[f.slug];
  if (!d) continue;
  if (d.action === 'noindex' && !/^noindex:\s*true/m.test(f.raw)) {
    console.error(`KONSISTENSI: ${f.slug} diputus noindex tapi frontmatter belum ada noindex: true`);
    gateFail = true;
  }
  if (d.action === 'redirect') {
    if (!d.to) { console.error(`KONSISTENSI: ${f.slug} redirect tanpa "to"`); gateFail = true; }
    else {
      const targetSlug = d.to.replace(/^\/blog\/|\/$/g, '');
      const t = bySlug.get(targetSlug);
      if (!t) { console.error(`KONSISTENSI: ${f.slug} → target ${d.to} tidak ada`); gateFail = true; }
      else if (decisions[targetSlug]?.action === 'redirect') {
        console.error(`KONSISTENSI: ${f.slug} → ${targetSlug} tapi target juga di-redirect (rantai 301)`); gateFail = true;
      }
      const fmLine = (f.raw.match(/^redirectTo:\s*"?(.*?)"?\s*$/m) ?? [])[1];
      if (fmLine !== d.to) {
        console.error(`KONSISTENSI: ${f.slug} redirect tapi frontmatter redirectTo="${fmLine ?? '(belum ada)'}" ≠ "${d.to}"`); gateFail = true;
      }
      if (redirectRules && !redirectRules.includes(`/blog/${f.slug}/  ${d.to}  301`)) {
        console.error(`KONSISTENSI: ${f.slug} redirect tapi aturan tidak ada di dist/_redirects (jalankan npm run redirects + build?)`); gateFail = true;
      }
    }
  }
  if (d.action === 'keep' && f.detect && (f.wc < 350 || f.boilerRatio >= 0.999)) {
    console.error(`KEPUTUSAN: ${f.slug} thin/boilerplate-total tapi di-keep — harus noindex/redirect atau alasan eksplisit kuat`);
    gateFail = true;
  }
}

if (gateFail) { console.error('\nGATE TERTUTUP.'); process.exit(1); }
console.log(`\nGATE TERBUKA: ${findings.length} keputusan tercatat & konsisten.`);
