#!/usr/bin/env node
/**
 * seo/generate.mjs — generator artikel properti via Qwen/Groq/opencode (plan Fase 10).
 *
 * Pipeline (mode template = default):
 *   queue.json → sort priority → pull top pending
 *   → 3 panggilan LLM kecil (partA: intro+H2 1-2, partB: H2 3-4, faq: 5 Q+A)
 *     — STRUKTUR dipegang skrip (seo/lib/article-template.mjs): judul H2,
 *     link internal, link keluar, tabel fakta, CTA, penutup semua deterministik.
 *     LLM hanya menulis prosa. Hemat token + gate hampir tak mungkin gagal
 *     karena link/judul.
 *   → assembleMdx (template prompts.ts) → validate gates → lintArticle
 *   → write Markdown draft ke site/src/collections/blog/<slug>.md
 *   → mark queue item status='draft'
 *
 * Provider chain per panggilan: Qwen (QWEN_API_KEY, DashScope OpenAI-compatible)
 * → Groq (GROQ_API_KEY) → opencode CLI rotasi free model. Satu attempt per
 * provider — gagal = keep pending untuk batch berikut, tidak ada retry boros.
 *
 * Usage:
 *   node seo/generate.mjs --count=2            (mode template)
 *   node seo/generate.mjs --count=2 --single   (mode satu prompt besar — lama)
 *   node seo/generate.mjs --count=1 --keyword="rasio cicilan terhadap gaji"
 *   node seo/generate.mjs --count=2 --dry
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { ROOT, BLOG_DIR, QUEUE_PATH, PROMPTS_PATH, KEYWORDS_PATH } from './paths.mjs';
import { PRICES, MONEY_PAGES, SITE } from './site.mjs';
import { injectGeoAnchor } from './lib/geo-anchor.mjs';
import { liveSlugs } from './lib/live-posts.mjs';
import { lintArticle, ASING } from './lib/article-lint.mjs';
import { imageAltFor } from './banner.mjs';
import {
  PARTS_SYSTEM_PROMPT,
  buildPartA,
  buildPartB,
  sectionTitles,
  pickOutbound,
  pickClosing,
  splitIntroSections,
  splitBodySections,
  parseFaqPart,
} from './lib/article-template.mjs';

// Antrean boleh belum ada di checkout pertama — tapi generator harus menjawab
// dengan pesan, bukan stack traceENOENT. seed-queue.mjs yang menulisnya.
if (!existsSync(QUEUE_PATH)) {
  console.error(`FATAL: ${QUEUE_PATH} belum ada.`);
  console.error('  Buat dulu (inventaris post impor, antrean masih kosong): node seo/seed-queue.mjs --inventory-only');
  console.error('  Setelah seo/keywords.json disetujui:            node seo/seed-queue.mjs');
  process.exit(1);
}
const QUEUE = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));

// ===== prompts.ts dimuat sebagai modul =====
// Perubahan terpenting dari port valleycity.id: di sana prompts.ts diekstrak lewat
// regex lalu di-eval, dan SEMUA helper template disalin ulang ke SHARED_HELPERS
// di dalam generate.mjs. Dua salinan berarti dua sumber kebenaran — dan salinan
// kedua pasti menyusul basi. Node >= 22 men-strip tipe TypeScript sendiri, jadi
// import langsung dipakai dan salinan bayangan itu dibuang.
const {
  SYSTEM_PROMPT,
  buildUserPrompt,
  buildPartPrompt,
  parseOutput,
  assembleMdx,
  deriveMeta,
  validateMdx,
  rpFiguresFrom,
} = await import('./prompts.ts');

if (!SYSTEM_PROMPT || SYSTEM_PROMPT.length < 100) {
  console.error('FATAL: SYSTEM_PROMPT kosong — periksa seo/prompts.ts');
  process.exit(1);
}

// ===== Free model rotation =====
// 1 Okt 2026: mimo-v2.5, ling-3.0-flash, muse-spark-1.2 MATI server-side.
// nemotron-lightning TIMEOUT utk output panjang (3x180s hangus) → dikeluarkan.
// Rotasi: big-pickle (panjang, kadang ngaco) + nemotron-ultra (rapi, kadang pendek).
const FREE_MODELS = [
  'opencode/big-pickle',
  'opencode/nemotron-3-ultra-free',
];
let modelIdx = 0;
function nextModel() {
  // Override uji model: SEO_MODEL=opencode/nemotron-3-ultra-free
  if (process.env.SEO_MODEL) return process.env.SEO_MODEL;
  return FREE_MODELS[modelIdx++ % FREE_MODELS.length];
}

// ===== opencode CLI runner =====
// ===== LLM provider =====
// Urutan: (1) Groq HTTP langsung (cepat ~20-40 dtk, gratis) kalau GROQ_API_KEY
// ada; (2) fallback opencode CLI rotasi free model. Hemat token: prompt sama,
// tidak ada retry boros — gagal = keep pending untuk batch berikut.
async function runGroq({ model, system, user, timeout = 120_000 }) {
  const key = process.env.GROQ_API_KEY;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
          temperature: 0.7,
          // 3000 TIDAK cukup untuk 1200-1400 kata body + 5 FAQ. Tokenizer
          // Indonesia padat: ~2,9 karakter/token, jadi 3000 token ~ 8791 karakter
          // dan output PUTUS tepat sebelum section FAQ. 4 Okt 2026.
          max_tokens: 6000,
        }),
      });
      if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 150)}`);
      const j = await res.json();
      const choice = j.choices?.[0];
      // Cek truncation secara eksplisit. Alir terpotong finish_reason='length'.
      // Tanpa cek ini, body terpotong lolos sebagai "sukses" lalu ditolak gate FAQ
      // dengan pesan menyesatkan ("FAQ hanya 0/5") — seolah model tidak patuh,
      // padahal penyebab sebenarnya tokennya habis.
      if (choice?.finish_reason === 'length') {
        const got = choice?.message?.content?.length ?? 0;
        throw new Error(
          `groq output TERPOTONG (finish_reason=length, ${got} karakter). ` +
            `Tambah max_tokens atau turunkan target kata di SYSTEM_PROMPT.`,
        );
      }
      const text = choice?.message?.content?.trim() || '';
      if (!text) throw new Error('groq empty response');
      return text;
  } finally {
    clearTimeout(t);
  }
}

function groqModel() {
  return process.env.SEO_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
}

// ===== Qwen (DashScope, OpenAI-compatible) =====
// Provider pertama di chain. Key dari user (QWEN_API_KEY); endpoint internasional
// default — kalau akunnya CN, cukup set QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1.
async function runQwen({ model, system, user, max_tokens = 3000, timeout = 120_000 }) {
  const key = process.env.QWEN_API_KEY;
  const base = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens,
        // Matikan reasoning internal: untuk artikel SEO yang dibutuhkan output
        // jadi, bukan proses berpikir. Thinking aktif membuat tiap panggilan
        // 90-108s (vs ~7s tanpa) — boros waktu untuk ratusan artikel. Gate
        // kualitas tetap menahan output yang buruk.
        enable_thinking: false,
      }),
    });
    if (!res.ok) throw new Error(`qwen ${res.status}: ${(await res.text()).slice(0, 150)}`);
    const j = await res.json();
    const choice = j.choices?.[0];
    // Sama seperti Groq: output terpotong jangan dianggap sukses — gate FAQ
    // akan menolak dengan pesan menyesatkan kalau ini lolos.
    if (choice?.finish_reason === 'length') {
      const got = choice?.message?.content?.length ?? 0;
      throw new Error(`qwen output TERPOTONG (finish_reason=length, ${got} karakter) — naikkan max_tokens`);
    }
    const text = choice?.message?.content?.trim() || '';
    if (!text) throw new Error('qwen empty response');
    return text;
  } finally {
    clearTimeout(t);
  }
}

function qwenModel() {
  return process.env.QWEN_MODEL || 'qwen-plus';
}

/**
 * Chain provider untuk SATU panggilan LLM: Qwen → Groq → opencode CLI rotasi
 * (2 model). Satu attempt per provider — hasil setengah jalan tidak pernah
 * ditulis; gagal di semua provider = keep pending untuk batch berikutnya.
 */
async function callLLM({ system, user, label, maxTokens = 3000 }) {
  const chain = [];
  if (process.env.QWEN_API_KEY && !process.env.SEO_CLI_ONLY) {
    chain.push([`qwen/${qwenModel()}`, () => runQwen({ model: qwenModel(), system, user, max_tokens: maxTokens })]);
  }
  if (process.env.GROQ_API_KEY && !process.env.SEO_CLI_ONLY) {
    chain.push([`groq/${groqModel()}`, () => runGroq({ model: groqModel(), system, user })]);
  }
  for (let i = 0; i < 2; i++) {
    const m = nextModel();
    chain.push([m, () => runOpencode({ model: m, prompt: `${system}\n\n${user}` })]);
  }
  let lastErr = null;
  for (const [name, fn] of chain) {
    try {
      console.log(`  [${label}] [${name}] call...`);
      const st = Date.now();
      let out = await fn();
      // Model preview kadang menyisipkan aksara asing (contoh nyata: "通 勤"
      // pada artikel Batujajar via qwen4-max-preview). Artikel = Bahasa
      // Indonesia berhuruf Latin; karakter yang DITOLAK gerbang ASING dibuang
      // di sini dengan regex impor yang SAMA (satu sumber kebenaran) — tidak
      // ada kata Latin yang diubah atau dikarang, hanya aksara asing yang
      // disingkirkan sebelum gate.
      out = out.replace(new RegExp(ASING.source, 'gu'), ' ').replace(/ {3,}/g, ' ');
      console.log(`  [${label}] ${((Date.now() - st) / 1000).toFixed(1)}s OK out=${out.length}c`);
      if (process.env.SEO_DEBUG) writeFileSync(`/tmp/seo-part-${label}.md`, out);
      return out;
    } catch (e) {
      lastErr = e;
      console.log(`  [${label}] FAIL ${name}: ${e.message.slice(0, 110)}`);
    }
  }
  throw lastErr || new Error('tidak ada provider LLM tersedia');
}

function runOpencode({ model, prompt, timeout = 420_000 }) {
  return new Promise((resolve, reject) => {
    const proc = spawn('opencode', ['run', '--model', model, '--format', 'default', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    const t = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`timeout ${timeout}ms`));
    }, timeout);
    proc.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`opencode exit ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// ===== Helpers =====
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

// ===== Sprint 1 guards (A4/A5b/A6) — helper murni, tidak lewat eval =====

// publishedSlugs: artikel yang benar-benar tayang — liveSlugs() memakai predikat
// yang sama dengan route Astro. Draft belum tampil = 404 kalau di-link, dan stub
// redirect hasil audit Fase 10 tampil sebagai 301: dua-duanya bukan target link.
function publishedSlugs() {
  return liveSlugs();
}

// A4: related diambil dari slug terpublish saja; judul dibaca dari frontmatter file.
function pickRelated(available) {
  if (!existsSync(BLOG_DIR)) return [];
  return available.slice(0, 2).map((slug) => {
    const raw = readFileSync(join(BLOG_DIR, `${slug}.md`), 'utf8');
    const m = raw.match(/^title: "?([^"\n]+)/m);
    return { slug, title: m ? m[1].trim() : slug };
  });
}

// A5b: normalisasi prosa -> set 3-gram -> Jaccard. Ambang 0.55 konservatif: artikel
// serumpun topik tetap lolos, hasil tempel-lolos / parafrase tipis ditolak.
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
function duplicateDraftInfo(mdx, selfSlug) {
  if (!existsSync(BLOG_DIR)) return null;
  const mine = gramSet(mdx);
  for (const f of readdirSync(BLOG_DIR).filter((x) => x.endsWith('.md'))) {
    const slug = f.replace(/\.md$/, '');
    if (slug === selfSlug) continue;
    if (jaccard(mine, gramSet(readFileSync(join(BLOG_DIR, f), 'utf8'))) >= 0.55) return slug;
  }
  return null;
}

// A6: FAQ harus ada dan pertanyaannya tidak kembar. Section hilang / dobel = hasil-pad.
function paddedFaqInfo(body) {
  const m = body.match(/##\s*(?:FAQ|Pertanyaan[^\n]*)\s*\n([\S\s]*?)(?=\n## |\n*$)/i);
  if (!m) return 'section FAQ tidak ada';
  const qs = [...m[1].matchAll(/\*\*([^*\n]+\?)\*\*/g)].map((x) => cleanProse(x[1])).filter(Boolean);
  if (qs.length >= 2 && new Set(qs).size !== qs.length) return 'pertanyaan FAQ duplikat';
  return null;
}

/**
 * Halaman uang site ini cuma beberapa: simulasi KPR, bagian unit/booking di
 * homepage, halaman agen, NUP, sale. Registry-nya hidup di site.mjs supaya
 * llms.mjs tidak punya salinan kedua. Pemetaan keyword -> target deterministik;
 * LLM tidak memilih sendiri (link karangan = 404).
 */

function pickMoneyLink(keyword) {
  const k = String(keyword || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const page of MONEY_PAGES) {
    const score = page.match.filter((w) => k.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = page; }
  }
  // Tanpa kecocokan: default ke simulator — angka cicilan adalah keputusan
  // pertama setiap pembeli rumah, dan halaman itu punya formulanya.
  return best ?? { url: '/simulasi-kpr/', anchor: 'simulasi cicilan KPR' };
}

/* Satu produk, jadi tidak ada "pool harga" seperti katalog layanan: yang dikirim
   ke prompt adalah angka rekaman, selalu utuh. */
function pickPrices() {
  return PRICES.top;
}



function extractFaqFromBody(body) {
  // Cari section FAQ di body. Accept multiple formats:
  //   A) YAML-like: "- q: \"...\" a: \"...\""
  //   B) Bold paragraphs: "**Question?**\n\nAnswer paragraph.\n\n"
  //   C) Numbered list: "1. Q? A."
  const m = body.match(/##\s*(?:FAQ|Pertanyaan[^\n]*)\s*\n([\s\S]*?)(?=\n## |\n> |\n*\[CTA|\n*$)/i);
  if (!m) return [];
  const block = m[1];
  const faqs = [];

  // Format A: YAML - q: ... a: ...
  const yamlMatches = [...block.matchAll(/(?:^|\n)\s*-?\s*q:\s*"?([^"\n]+?)"?\s*\n?\s*a:\s*"?([^"\n]+?)"?/g)];
  for (const y of yamlMatches.slice(0, 5)) {
    const q = y[1].trim();
    const a = y[2].trim();
    if (q && a) faqs.push({ q, a });
  }
  if (faqs.length >= 5) return faqs.slice(0, 5);

  // Format B: Bold question + paragraph answer (toleran emphasis *..* di dalam Q)
  if (faqs.length < 5) {
    const boldMatches = [...block.matchAll(/\*\*(.+?\?)\*\*\s*\n+\s*([^\n]+)/g)];
    for (const m2 of boldMatches.slice(0, 5 - faqs.length)) {
      faqs.push({ q: m2[1].trim(), a: m2[2].trim() });
    }
  }

  // Format C: Numbered list
  if (faqs.length < 5) {
    const numbered = [...block.matchAll(/(\d+)\.\s*\*?\*?([^*\n]+\?)\*?\*?\s*\n?\s*([^*\n][^\n]+)/g)];
    for (const n of numbered.slice(0, 5 - faqs.length)) {
      faqs.push({ q: n[2].trim(), a: n[3].trim() });
    }
  }

  return faqs.slice(0, 5);
}

// A5: validasi eksistensi link internal /blog/<slug>. Target HARUS artikel publish di disk
// (draft belum live = 404; slug karangan LLM = 404). Halaman uang (/simulasi-kpr/, /#unit,
// /agent/, ...) TIDAK dicek di sini — selalu disuplai pickMoneyLink dari whitelist
// deterministik, bukan dikarang LLM.
function blogLinkBrokenInfo(mdx, validSlugs) {
  const valid = new Set(validSlugs);
  const broken = new Set();
  for (const m of mdx.matchAll(/\/blog\/([a-z0-9][a-z0-9-]*)/g)) {
    if (!valid.has(m[1])) broken.add(m[1]);
  }
  return broken.size ? [...broken] : null;
}

/**
 * Gerbang keyword. Sama persis fungsinya dengan versi socio.id — generator
 * berhenti kalau daftar kata kunci belum disetujui manusia — tapi sumbernya
 * kini satu berkas yang dirawat tangan: seo/keywords.json.
 *
 * geo-expand tidak di-port: site ini punya satu lokasi, jadi "matriks kota x
 * layanan" (980 KB di proyek sebelumnya) tidak ada padanannya. Variasi geografis yang
 * masuk akal = Padalarang / Cimahi / Bandung Barat, dan itu dituliskan langsung
 * di keywords.json bersama local_anchor-nya.
 *
 * Ambang bawah default 25: cukup untuk menjaga generator tidak mengulang
 * tema yang sama, tetap realistis untuk satu proyek properti.
 */
// Tanggal selalu WIB (UTC+7) — dipakai KPI 'Dibuat hari ini' di dashboard.
const wibDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function keywordGate() {
  if (!existsSync(KEYWORDS_PATH)) {
    return `${KEYWORDS_PATH} belum ada — daftar keyword harus disetujui dulu sebelum satu artikel pun dibuat`;
  }
  const kw = JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8'));
  if (!kw._meta || !kw._meta.approved_at) {
    return 'keywords.json belum di-approve user (isi _meta.approved_at)';
  }
  const approved = (kw.items || []).filter((x) => x.approved === true).length;
  const min = Number(process.env.SEO_MIN_KEYWORDS || 25);
  if (approved < min) return `baru ${approved} keyword disetujui, ambang gate ${min}`;
  const inQueue = QUEUE.items.filter((i) => i.status === 'pending').length;
  if (inQueue === 0) return 'queue kosong — tambahkan keyword approved ke seo/queue.json';
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  // Mode template (split kecil) = DEFAULT sejak modul article-template.mjs.
  // --single = path lama satu prompt besar, hanya untuk perbandingan/debug.
  const opts = { count: 1, dry: false, keyword: null, slug: null, ignoreGate: false, list: 0, deferQueue: false, mergeQueue: false, split: true };
  for (const a of args) {
    if (a.startsWith('--count=')) opts.count = parseInt(a.slice(8));
    else if (a === '--dry') opts.dry = true;
    else if (a === '--ignore-gate') opts.ignoreGate = true;
    else if (a.startsWith('--keyword=')) opts.keyword = a.slice(10);
    else if (a.startsWith('--slug=')) opts.slug = a.slice(7);
    // Mode freshness: regenerasi artikel yang SUDAH publish (status publish
    // dipertahankan, `updated` di-bump hari ini) — dipanggil seo/freshness.mjs.
    else if (a.startsWith('--refresh=')) { opts.refresh = a.slice(10); opts.slug = opts.refresh; }
    else if (a.startsWith('--list=')) opts.list = parseInt(a.slice(7));
    else if (a === '--defer-queue') opts.deferQueue = true;
    else if (a === '--merge-queue') opts.mergeQueue = true;
    else if (a === '--single') opts.split = false;
  }
  return opts;
}

// Merge hasil worker paralel: Markdown status:draft di disk yang queue-nya masih
// pending → tandai draft. Dipanggil SEKALI oleh orkestrator setelah semua
// worker selesai (hindari race tulis queue.json antar worker).
function mergeQueue() {
  let marked = 0;
  const files = existsSync(BLOG_DIR) ? readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')) : [];
  const draftSlugs = new Set(
    files
      .filter((f) => readFileSync(join(BLOG_DIR, f), 'utf8').includes('\nstatus: draft'))
      .map((f) => f.replace(/\.md$/, '')),
  );
  for (const it of QUEUE.items) {
    if (it.status === 'pending' && it.slug && draftSlugs.has(it.slug)) {
      it.status = 'draft';
      it.notes = (it.notes || '') + ` | generated ${wibDay()}`;
      it.generatedAt = it.generatedAt || wibDay();
      marked++;
    }
  }
  if (marked > 0) {
    writeFileSync(QUEUE_PATH, JSON.stringify(QUEUE, null, 2) + '\n');
  }
  console.log(`merge-queue: ${marked} item pending → draft`);
}

async function main() {
  const opts = parseArgs();
  const sigW = { high: 4, medium: 3, 'geo-matrix': 3, 'longtail-intent': 3, aeo: 2, low: 1 };
  const sig = (d) => sigW[d] ?? 2;

  // Gate Fase F (keputusan user 30 Sep): daftar keyword geo/longtail harus sudah
  // dikurasi + di-approve SEBELUM satu artikel pun digenerate. Ini mencegah mesin
  // membalik ribuan halaman kota tanpa daftar yang disetujui manusia.
  const gateReason = keywordGate();
  if (gateReason) {
    if (opts.ignoreGate) {
      console.warn('PERINGATAN KERAS: --ignore-gate dipakai. Gate Fase F dilanggar: ' + gateReason);
    } else {
      console.error('GATE FASE F TERTUTUP: ' + gateReason);
      console.error('Lewati dengan benar: set seo/keywords.json _meta.approved_at + _meta.approved_by, lalu `node seo/seed-queue.mjs` untuk memindahkan keyword approved ke antrean.');
      process.exit(1);
    }
  }

  // Backlog cap (#19): tahan generate bila draft sudah menumpuk. Tanpa ini,
  // saat publish tertahan (GSC mati / ramp hold) generator terus menumpuk draft
  // yang tidak pernah tayang — backlog tak terbatas. Batas dari SEO_BACKLOG_MAX.
  const backlogMax = Number(process.env.SEO_BACKLOG_MAX || 16);
  const draftBacklog = QUEUE.items.filter((i) => i.status === 'draft').length;
  if (Number.isFinite(backlogMax) && draftBacklog >= backlogMax) {
    console.error(`BACKLOG CAP: ${draftBacklog} draft >= batas ${backlogMax} — generate ditahan sampai draft dipublish.`);
    console.error('Turunkan backlog: node seo/publish-git.mjs --count=N (atau naikkan SEO_BACKLOG_MAX bila memang sengaja).');
    process.exit(1);
  }

  // Urutan antrean (keputusan user 30 Sep): KOTA DULU.
  // 1. Geo (`added_by:geo`) didahulukan, round-robin per kota supaya variasi
  //    (tidak 12x kota yang sama beruntun). Kota tier-1 (prioritas tertinggi)
  //    jalan di ronde awal; dalam satu kota urut intent: head > service > trust.
  // 2. Head term non-geo (katalog/AEO) setelah antrean geo habis.
  const score = (i) => i.priority + sig(i.demand_signal) * 5;
  function pickTargets(items, count) {
    const pend = items.filter((i) => i.status === 'pending');
    const geo = pend.filter((i) => i.added_by === 'geo').sort((a, b) => score(b) - score(a));
    const byCity = new Map();
    for (const g of geo) {
      const k = g.city || '-';
      if (!byCity.has(k)) byCity.set(k, []);
      byCity.get(k).push(g);
    }
    const cities = [...byCity.keys()].sort(
      (a, b) => score(byCity.get(b)[0]) - score(byCity.get(a)[0]),
    );
    const ordered = [];
    const seen = new Set();
    // Offset diagonal per kota: ronde 0 = kota0→intent0, kota1→intent1, ...
    // sehingga 24 artikel pertama langsung campur intent (anti-doorway),
    // bukan 24x pola yang sama beda kota.
    for (let round = 0; ordered.length < geo.length; round++) {
      let added = false;
      cities.forEach((c, ci) => {
        const q = byCity.get(c);
        const pick = q[(round + ci) % q.length];
        if (pick && !seen.has(pick.keyword)) {
          seen.add(pick.keyword);
          ordered.push(pick);
          added = true;
        }
      });
      if (!added) break;
    }
    const rest = pend
      .filter((i) => i.added_by !== 'geo')
      .sort((a, b) => score(b) - score(a));
    return [...ordered, ...rest].slice(0, count);
  }

  let targets;
  if (opts.slug) {
    // Aksi per-baris di dashboard: tulis ulang artikel spesifik.
    // Kandidat: pending (tulis baru) ATAU draft (tulis ulang — file ditimpa).
    targets = QUEUE.items.filter((i) => i.slug === opts.slug &&
      (opts.refresh ? i.status === 'published' : (i.status === 'pending' || i.status === 'draft')));
    if (!targets.length) {
      console.error(opts.refresh
        ? `slug ${opts.refresh} tidak ditemukan sebagai artikel TERBIT di antrean`
        : `slug ${opts.slug} tidak ditemukan di antrean (pending/draft)`);
      process.exit(1);
    }
  } else if (opts.keyword) {
    targets = QUEUE.items.filter((i) => i.keyword === opts.keyword && i.status === 'pending');
  } else {
    targets = pickTargets(QUEUE.items, opts.count);
  }

  console.log(`Targets: ${targets.length} (count=${opts.count} dry=${opts.dry})`);
  for (const t of targets) {
    console.log(`  p${t.priority} ${t.demand_signal.padEnd(6)} ${t.keyword} (cluster=${t.cluster})`);
  }
  if (opts.dry) return;
  if (opts.list) {
    // Mode orkestrator paralel: cetak N keyword sekaligus. Versi lama memakai
    // `targets` yang sudah di-apply --count (default 1), jadi --list=20 hanya
    // mencetak 1 keyword — akibatnya generate-parallel.sh menjalankan keyword
    // yang sama di semua worker. Di sini langsung pickTargets dengan opts.list.
    const listItems = opts.keyword
      ? QUEUE.items.filter((i) => i.keyword === opts.keyword && i.status === 'pending')
      : pickTargets(QUEUE.items, opts.list);
    for (const t of listItems) console.log(`KW::${t.keyword}`);
    return;
  }
  if (opts.mergeQueue) {
    mergeQueue();
    return;
  }

  let ok = 0, fail = 0;
  const written = [];
  for (const t of targets) {
    console.log(`\n--- ${t.keyword} ---`);
    const slug = t.slug || slugify(t.keyword);
    const outPath = join(BLOG_DIR, `${slug}.md`);
    if (existsSync(outPath) && !opts.refresh) {
      console.log(`  SKIP: exists`);
      continue;
    }
    // Refresh: pertahankan tanggal terbit ASLI (date tidak boleh berubah —
    // hanya `updated` yang di-bump supaya lastmod jujur pada konten baru).
    const origDate = opts.refresh && existsSync(outPath)
      ? (((readFileSync(outPath, 'utf8').match(/^date:\s*"?([^"\n]+)/m) || [])[1] || '').trim())
      : '';

    const prices = pickPrices(t.keyword);
    // A4: related HANYA dari artikel publish di disk (bukan tebakan queue) — cegah 404.
    const related = pickRelated(publishedSlugs().filter((s) => s !== slug));
    const moneyLink = pickMoneyLink(t.keyword, prices);
    // PRICES.top di site.mjs sudah terformat string rupiah ({platform, price,
    // installment, note}) — versi lama memakai p.name + toLocaleString() pada
    // string = blok angka rusak di prompt.
    const pricesBlock = prices
      .slice(0, 6)
      .map((p) => `- ${p.platform}: KPR ${p.price}, cicilan ${p.installment} (${p.note})`)
      .join('\n');

    const user = buildUserPrompt({
      keyword: t.keyword,
      category: t.category || 'Lainnya',
      related,
      pricesBlock,
      // Anti-doorway: artikel geo bawa fakta ekonomi lokal dari cities.json.
      localAnchor: t.local_anchor || null,
      localBuyer: t.local_buyer || null,
    });
    console.log(`  user prompt len: ${user.length}`);
    if (process.env.SEO_DEBUG) writeFileSync('/tmp/seo-user.txt', user);

    // ── LLM panggilan ──────────────────────────────────────────────────────
    // Mode template (default): struktur dipegang lib/article-template.mjs —
    // judul H2, link internal/keluar, tabel fakta, CTA, penutup semua statik;
    // LLM hanya menulis prosa lewat 3 panggilan kecil. --single: path lama
    // satu prompt besar (provider chain sama via callLLM).
    let raw = null;
    let faqPairs = null;
    if (opts.split) {
      const titles = sectionTitles(t.keyword);
      const ob = pickOutbound(t);
      const ctx = {
        keyword: t.keyword,
        category: t.category || 'Lainnya',
        intent: t.intent || null,
        pricesBlock,
        localAnchor: t.local_anchor || null,
        localBuyer: t.local_buyer || null,
        titles,
      };
      try {
        // Retry tunggal terarah bila struktur prosa kurang (section tipis /
        // pembuka pendek) — panggilan murah ~5s, bukan retry boros seluruh
        // artikel. Model tanpa thinking kadang menulis section <60 kata.
        let a = null;
        for (let attempt = 0; attempt < 2 && !a; attempt++) {
          const pA = await callLLM({ system: PARTS_SYSTEM_PROMPT, user: buildPartA(ctx), label: 'partA' });
          a = splitIntroSections(parseOutput(pA));
          if (!a && attempt === 0) console.log('  partA struktur kurang — ulang sekali');
        }
        if (!a) throw new Error('partA: <2 section atau pembuka terlalu pendek');
        let b = null;
        for (let attempt = 0; attempt < 2 && !b; attempt++) {
          const pB = await callLLM({ system: PARTS_SYSTEM_PROMPT, user: buildPartB(ctx), label: 'partB' });
          b = splitBodySections(parseOutput(pB));
          if (!b && attempt === 0) console.log('  partB struktur kurang — ulang sekali');
        }
        if (!b) throw new Error('partB: <2 section');
        const pFaq = await callLLM({ system: PARTS_SYSTEM_PROMPT, user: buildPartPrompt('faq', ctx), label: 'faq' });
        faqPairs = parseFaqPart(pFaq);
        if (faqPairs.length < 5) throw new Error(`FAQ hanya ${faqPairs.length}/5 dari LLM`);
        // Link internal: CTA membawa /simulasi-kpr/; dua link related datang
        // dari assembleMdx hanya bila korpus publish >= 2. Korpus baru =
        // fallback deterministik (money pages, bukan slug karangan LLM).
        const fallbackInternal =
          related.length >= 2
            ? ''
            : 'Sebelum mengambil keputusan, cek [peta lokasi Padalarang](/#lokasi) dan [denah tipe unit](/#unit).';
        raw = [
          a.intro,
          `## ${titles[0]}`, a.sections[0],
          `## ${titles[1]}`, a.sections[1],
          `## ${titles[2]}`, b.sections[0],
          `## ${titles[3]}`, b.sections[1],
          pickClosing(t.keyword),
          ob.line,
          fallbackInternal,
        ].filter(Boolean).join('\n\n');
        console.log(`  ✓ template: ~${raw.split(/\s+/).length} kata body, outbound: ${ob.anchor}`);
      } catch (e) {
        console.log(`  FINAL FAIL (template): ${e.message} — keep pending`);
        fail++;
        continue;
      }
    } else {
      try {
        raw = await callLLM({ system: SYSTEM_PROMPT, user, label: 'single', maxTokens: 6000 });
      } catch (e) {
        console.log(`  FINAL FAIL — ${e.message} — keep pending`);
        fail++;
        continue;
      }
    }

    if (!raw) {
      console.log(`  FINAL FAIL — keep pending`);
      fail++;
      continue;
    }

    // Parse + assemble. Mode template: FAQ sudah dipisah saat panggilan ke-3
    // (faqPairs), body tidak mengandung section FAQ. Mode single: FAQ dibaca
    // dari body seperti versi lama.
    const llmBody = parseOutput(raw);
    const faq = faqPairs || extractFaqFromBody(llmBody);
    // A6: FAQ < 5 atau terindikasi hasil-pad = LLM tidak patuh. Dulu blok ini men-pad
    // dengan pertanyaan generik — sekarang artikel ditolak supaya korpus tetap bersih.
    if (faq.length < 5) {
      console.log(`  REJECT: FAQ hanya ${faq.length}/5 — tanpa pad generik`);
      fail++;
      continue;
    }
    if (!faqPairs) {
      const padReason = paddedFaqInfo(llmBody);
      if (padReason) {
        console.log(`  REJECT: FAQ ${padReason}`);
        fail++;
        continue;
      }
    }
    const meta = deriveMeta({ keyword: t.keyword, llmBody, category: t.category || 'Lainnya' });
    if (opts.refresh && origDate) {
      // Refresh = ganti ISI, bukan identitas halaman. deriveMeta men-slug-kan
      // ulang dari keyword (bisa beda dari slug file legacy) dan bikin judul
      // baru — keduanya MEMBAUN nomeleskan URL yang sedang dipantau Google.
      // Ambil identitas lama dari frontmatter; hanya `updated` yang baru.
      const src0 = readFileSync(outPath, 'utf8');
      const fm0 = ((src0.match(/^---\n([\s\S]*?)\n---/) || [])[1]) || '';
      const grab = (k) => (((fm0.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?\\s*$`, 'm')) || [])[1]) || '').trim();
      meta.pubDate = origDate;
      meta.slug = t.slug;
      if (grab('title')) meta.title = grab('title');
      if (grab('description')) meta.description = grab('description');
      const tagsLine = (fm0.match(/^tags:\s*\[([^\]]*)\]/m) || [])[1];
      if (tagsLine) meta.tags = tagsLine.split(',').map((x) => x.replace(/"/g, '').trim()).filter(Boolean);
      if (meta.cover) meta.imageAlt = imageAltFor(meta.title, meta.cover); // alt mengikuti judul asli
    }

    let mdx = assembleMdx({
      llmBody,
      prices,
      moneyLink,
      related,
      faq,
      meta,
      status: opts.refresh ? 'publish' : 'draft',
      updated: opts.refresh ? wibDay() : '',
    });
    // Anchor kota untuk artikel geo: disuntik DETERMINISTIK setelah assembleMdx.
    // Bukan bergantung pada LLM menulisnya — free model sering tidak patuh, dan
    // tanpa anchor halaman geo jadi doorway page (lihat §14.13).
    if (t.local_anchor) {
      const patched = injectGeoAnchor(mdx, t);
      if (patched !== mdx) {
        if (process.env.SEO_DEBUG) console.log('  + anchor kota disuntik');
        mdx = patched;
      }
    }

    if (process.env.SEO_DEBUG) writeFileSync('/tmp/seo-assembled.md', mdx);

    const v = validateMdx(mdx, t.keyword, rpFiguresFrom(t.local_buyer), { allowPublish: !!opts.refresh });
    if (!v.ok) {
      console.log(`  GATES FAIL: ${v.errors.join(' | ')}`);
      console.log(`  (body preview) ${llmBody.slice(0, 300)}`);
      fail++;
      continue;
    }
    console.log(`  ✓ ${v.words} kata, ${v.h2Count} H2, ${v.faqCount} FAQ, ${v.internalLinks} internal links`);

    // A5: semua tautan /blog/<slug> di body harus menunjuk artikel publish (cegah 404 internal).
    const brokenLinks = blogLinkBrokenInfo(mdx, publishedSlugs());
    if (brokenLinks) {
      console.log(`  REJECT: link /blog/ ke slug tak publish: ${brokenLinks.join(', ')}`);
      fail++;
      continue;
    }

    // A5b: guard anti-duplikat terhadap seluruh korpus Markdown sebelum tulis file.
    const dupOf = duplicateDraftInfo(mdx, slug);
    if (dupOf) {
      console.log(`  REJECT: duplikat (Jaccard >= 0.55 vs "${dupOf}")`);
      fail++;
      continue;
    }

    // A6: gate kualitas TEKS. `validateMdx` di atas hanya menyorot frontmatter
    // (title ≤70, description ≤160, faq = 5) — tidak menyentuh isi paragraf.
    // Akibatnya kelas glitch `yang_filters`, `sebelumellos. hasten.`,
    // `Pertanyaan about harga` lolos ke korpus tanpa pernah ditahan (terbukti
    // 4 Okt 2026: 7 glitch di 5 artikel, semua lolos SEMUA gate yang ada).
    // Modul yang sama dipakai `check-article.mjs` — satu implementasi, dua pintu.
    // MENOLAK = tidak ditulis ke disk, sama seperti gate di atasnya.
    const { err: lintErr } = lintArticle(mdx);
    if (lintErr.length) {
      console.log(`  REJECT: gate teks gagal (${lintErr.length})`);
      for (const e of lintErr) console.log(`      - ${e}`);
      fail++;
      continue;
    }

    writeFileSync(outPath, mdx);
    written.push(outPath);
    if (opts.refresh) {
      // Status TETAP published; hanya catatan + updated (di frontmatter) yang
      // berubah — queue tidak boleh kembali draft.
      t.notes = (t.notes || '') + ` | refreshed ${wibDay()}`;
    } else {
      t.status = 'draft';
      t.notes = (t.notes || '') + ` | generated ${wibDay()}`;
      t.generatedAt = wibDay();
    }
    ok++;
  }

  if (ok > 0 && !opts.deferQueue) {
    writeFileSync(QUEUE_PATH, JSON.stringify(QUEUE, null, 2) + '\n');
    console.log(`\nWrote queue.json: ${ok} draft(s) added`);
  } else if (ok > 0) {
    console.log(`\n--defer-queue: Markdown tertulis, queue di-merge belakangan`);
  }

  // Daya tahan file draft: file .md tinggal di LAYER container, bukan volume —
  // deploy berikutnya (checkout -f dari origin/main) menghapusnya sementara
  // queue.json (volume) tetap status 'draft' → jadilah draft hantu tanpa file
  // yang tidak akan pernah bisa dipublish (pickDrafts menolaknya). Komprominya:
  // file draft ikut di-commit+push tiap batch, sama seperti publish-git.
  if (written.length) {
    if (process.env.GITHUB_TOKEN && existsSync(join(ROOT, '.git'))) {
      try {
        const b64 = Buffer.from('x-access-token:' + process.env.GITHUB_TOKEN).toString('base64');
        const auth = ['-c', `http.extraHeader=AUTHORIZATION: basic ${b64}`];
        // Mirror antrean ke jalur REPO (seo/queue.json) dulu. JANGAN sekali-kali
        // `git add` QUEUE_PATH kalau isinya volume (/app/data) — file volume yang
        // ter-commit akan ditimpa `git checkout -f` tiap deploy dan MEMBALIK
        // status publish yang baru terjadi (insiden 16 Nov 2026).
        const repoQueue = join(ROOT, 'seo/queue.json');
        if (resolve(QUEUE_PATH) !== resolve(repoQueue)) copyFileSync(QUEUE_PATH, repoQueue);
        execFileSync('git', [...auth, 'add', '--', ...written, repoQueue], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        execFileSync('git', [...auth, 'commit', '-q', '-m', opts.refresh ? `refresh(seo): perbarui ${opts.refresh} — konten baru, updated ${wibDay()}, status tetap publish` : `chore(generate): ${written.length} draft baru (otomatis)`], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        execFileSync('git', [...auth, 'push', '-q', 'origin', 'HEAD:main'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        console.log(`Draft ${written.length} file + queue di-commit & push (tahan redeploy).`);
      } catch (e) {
        console.warn(`[generate] commit/push draft GAGAL — file tetap lokal, BISA hilang saat redeploy: ${String(e.message).slice(0, 200)}`);
      }
    } else {
      console.warn('[generate] GITHUB_TOKEN/.git absen — draft TIDAK dipush, akan hilang saat redeploy.');
    }
  }

  // Jalur refresh: setelah push, halaman di-deploy ke Cloudflare Pages lalu
  // Google/Bing diberi tahu konten berubah (URL_UPDATED + IndexNow) — kalau tidak,
  // hasil segaran hanya hidup di repo, bukan di situs.
  if (opts.refresh && written.length) {
    try {
      const { deployPages, verifyUrls } = await import('./publish-git.mjs');
      const deployed = await deployPages();
      if (deployed) {
        const url = `${SITE}/blog/${opts.refresh}/`;
        try { await verifyUrls([url]); } catch (e) { console.warn(`  ⚠ verifikasi live: ${e.message}`); }
        try {
          const { publishIndexing } = await import('./lib/gsc.mjs');
          const r = await publishIndexing(url, 'URL_UPDATED');
          console.log(`  GSC URL_UPDATED: ${r ? 'OK' : 'gagal'}`);
        } catch (e) { console.warn(`  ⚠ GSC URL_UPDATED: ${e.message.slice(0, 100)}`); }
        const r = spawnSync(process.execPath, [join(ROOT, 'seo', 'indexnow.mjs'), url], {
          cwd: ROOT, encoding: 'utf8', env: { ...process.env },
        });
        console.log(String(r.stdout || '').trim().split('\n').slice(-2).join(' | '));
      } else {
        console.warn('  ⚠ deploy Pages gagal — perubahan tersimpan di repo, deploy menyusul.');
      }
    } catch (e) {
      console.warn(`  ⚠ tahap pasca-refresh gagal (konten sudah ter-push): ${String(e.message).slice(0, 160)}`);
    }
  }

  console.log(`\nSummary: ${ok} ok, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});