#!/usr/bin/env node
// seo/qc.mjs — quality-check draft Markdown yang ditulis manual/agent terhadap SELURUH
// gate pipeline (validateMdx + anti-dup Jaccard + FAQ pad + broken link), TANPA
// memanggil LLM. Dipakai untuk memverifikasi artikel yang saya tulis langsung.
//
// NOTE: hindari literal backslash-n di regex/string sumber (editor bisa decode
// jadi newline -> regex putus). Pakai NL = String.fromCharCode(10) bila butuh.
//
// Usage:
//   node seo/qc.mjs                      # cek semua draft (status:draft) di BLOG_DIR
//   node seo/qc.mjs slug-satu slug-2     # cek slug tertentu
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, QUEUE_PATH } from './paths.mjs';
import { liveSlugs } from './lib/live-posts.mjs';

const NL = String.fromCharCode(10);
const DRAFT_FLAG = NL + 'status: draft';

// --- pull validateMdx from prompts.ts (same brace-count extraction as generate.mjs) ---
const promptsSrc = readFileSync(new URL('./prompts.ts', import.meta.url), 'utf8');
function extractBody(name) {
  const idx = promptsSrc.indexOf(`export function ${name}`);
  if (idx < 0) throw new Error(`function ${name} not found in prompts.ts`);
  const start = promptsSrc.indexOf('{', idx);
  let d = 0, end = start;
  for (let i = start; i < promptsSrc.length; i++) {
    if (promptsSrc[i] === '{') d++;
    if (promptsSrc[i] === '}') { d--; if (d === 0) { end = i + 1; break; } }
  }
  return promptsSrc.slice(start + 1, end - 1);
}
function stripTs(s) {
  return s
    .replace(/:\s*(string|number|boolean|any|void|Promise<[^>]*>|Record<[^>]*>|\{[^}]*\}(\[[^\]]*\])?)(\s*[=,)])/g, '$3')
    .replace(/as\s+(const|string|number|any)\b/g, '')
    .replace(/<[A-Za-z][\w,<> ]*>\(/g, '(');
}
const validateMdx = new Function('content', 'keyword', stripTs(extractBody('validateMdx')));

// --- dedup (mirror generate.mjs A5b) ---
const cleanProse = (s) => String(s).toLowerCase()
  .replace(/\[\[[^\]]*\]\]/g, ' ')
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/\[([^[\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\s+/g, ' ').trim();
function gramSet(s, n = 3) {
  const w = cleanProse(s).split(' ').filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}
function dupInfo(mdx, selfSlug) {
  const mine = gramSet(mdx);
  for (const f of readdirSync(BLOG_DIR).filter((x) => x.endsWith('.md'))) {
    const slug = f.replace(/\.md$/, '');
    if (slug === selfSlug) continue;
    const j = jaccard(mine, gramSet(readFileSync(join(BLOG_DIR, f), 'utf8')));
    if (j >= 0.55) return { slug, j };
  }
  return null;
}
// line-based FAQ section check (no literal newline in source)
function paddedFaqInfo(body) {
  const lines = body.split(NL);
  const i = lines.findIndex((l) => /^##\s*(FAQ|Pertanyaan)/i.test(l.trim()));
  if (i < 0) return 'section FAQ tidak ada';
  const qs = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) break;
    const m = lines[j].match(/\*\*([^*]+\?)\*\*/);
    if (m) qs.push(cleanProse(m[1]));
  }
  if (qs.length >= 2 && new Set(qs).size !== qs.length) return 'pertanyaan FAQ duplikat';
  return null;
}
function blogLinkBroken(mdx, validSlugs) {
  const valid = new Set(validSlugs);
  const broken = new Set();
  for (const m of mdx.matchAll(/\/blog\/([a-z0-9][a-z0-9-]*)/g)) if (!valid.has(m[1])) broken.add(m[1]);
  return broken.size ? [...broken] : null;
}
function bodyOf(mdx) {
  const m = mdx.match(/^---[\s\S]*?---/);
  return m ? mdx.slice(m[0].length) : mdx;
}

const QUEUE = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
const kwBySlug = {};
for (const it of QUEUE.items) {
  const slug = it.slug || it.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  kwBySlug[slug] = it.keyword;
}
const allMdx = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
// liveSlugs() = predikat route Astro (publish + bukan redirect). Draft dan stub
// redirect keluar dari daftar, supaya target link yang diperiksa QC benar-benar 200.
const publishedSlugs = liveSlugs();

const argSlugs = process.argv.slice(2);
const targets = argSlugs.length
  ? argSlugs
  : allMdx.filter((s) => readFileSync(join(BLOG_DIR, `${s}.md`), 'utf8').includes(DRAFT_FLAG));

let allOk = true;
for (const slug of targets) {
  const path = join(BLOG_DIR, `${slug}.md`);
  if (!existsSync(path)) { console.log(`SKIP ${slug} (file tidak ada)`); continue; }
  const mdx = readFileSync(path, 'utf8');
  const keyword = kwBySlug[slug] || slug.replace(/-/g, ' ');
  const v = validateMdx(mdx, keyword);
  const dup = dupInfo(mdx, slug);
  const faqPad = paddedFaqInfo(bodyOf(mdx));
  const broken = blogLinkBroken(mdx, publishedSlugs);
  const errs = [...(v.errors || [])];
  if (dup) errs.push(`DUPLICATE vs "${dup.slug}" (Jaccard ${dup.j.toFixed(2)})`);
  if (faqPad) errs.push(`FAQ: ${faqPad}`);
  if (broken) errs.push(`BROKEN /blog link: ${broken.join(', ')}`);
  const ok = errs.length === 0;
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${slug}  [${v.words ?? '?'} kata, h2=${v.h2Count ?? '?'}, link=${v.internalLinks ?? '?'}]`);
  if (!ok) console.log('   ->', errs.join(' | '));
}
console.log(allOk ? NL + '=== SEMUA LOLOS GATE ===' : NL + '=== ADA YANG GAGAL ===');
process.exit(allOk ? 0 : 1);
