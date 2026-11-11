#!/usr/bin/env node
/**
 * seo/generate.mjs — generator artikel properti via opencode/Groq (plan Fase 10).
 *
 * Pipeline:
 *   queue.json → sort priority → pull top pending
 *   → build prompt → spawn `opencode run --model <free>` (stdin)
 *   → parse output → assemble Markdown via template (prompts.ts)
 *   → validate gates → write Markdown draft ke site/src/collections/blog/<slug>.md
 *   → mark queue item status='draft'
 *
 * Provider: opencode/* free models (rotasi round-robin).
 *   Available (verified Sep 2026): mimo-v2.5-free, ling-3.0-flash-fin-free,
 *   muse-spark-1.2-contributor-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free.
 *   Plus 'big-pickle' sebagai fallback.
 *
 * Token budget: ~2.5k token/artikel (system 200 + user 250 + output 2000).
 * Timeout: 180s per call. Retry 1x ganti model jika error.
 *
 * Usage:
 *   node seo/generate.mjs --count=2
 *   node seo/generate.mjs --count=1 --keyword="rasio cicilan terhadap gaji"
 *   node seo/generate.mjs --count=2 --dry
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { ROOT, BLOG_DIR, QUEUE_PATH, PROMPTS_PATH, KEYWORDS_PATH } from './paths.mjs';
import { PRICES, MONEY_PAGES } from './site.mjs';
import { injectGeoAnchor } from './lib/geo-anchor.mjs';
import { liveSlugs } from './lib/live-posts.mjs';
import { lintArticle } from './lib/article-lint.mjs';

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
  const opts = { count: 1, dry: false, keyword: null, ignoreGate: false, list: 0, deferQueue: false, mergeQueue: false, split: false };
  for (const a of args) {
    if (a.startsWith('--count=')) opts.count = parseInt(a.slice(8));
    else if (a === '--dry') opts.dry = true;
    else if (a === '--ignore-gate') opts.ignoreGate = true;
    else if (a.startsWith('--keyword=')) opts.keyword = a.slice(10);
    else if (a.startsWith('--list=')) opts.list = parseInt(a.slice(7));
    else if (a === '--defer-queue') opts.deferQueue = true;
    else if (a === '--merge-queue') opts.mergeQueue = true;
    else if (a === '--split') opts.split = true;
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
      it.notes = (it.notes || '') + ` | generated ${new Date().toISOString().slice(0, 10)}`;
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
  if (opts.keyword) {
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
  for (const t of targets) {
    console.log(`\n--- ${t.keyword} ---`);
    const slug = t.slug || slugify(t.keyword);
    const outPath = join(BLOG_DIR, `${slug}.md`);
    if (existsSync(outPath)) {
      console.log(`  SKIP: exists`);
      continue;
    }

    const prices = pickPrices(t.keyword);
    // A4: related HANYA dari artikel publish di disk (bukan tebakan queue) — cegah 404.
    const related = pickRelated(publishedSlugs().filter((s) => s !== slug));
    const moneyLink = pickMoneyLink(t.keyword, prices);
    const pricesBlock = prices.slice(0, 6).map((p) => `- ${p.platform} ${p.name} (Rp${p.price.toLocaleString('id-ID')}/1k)`).join('\n');

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

    // Call LLM: Groq HTTP dulu (cepat), fallback rotasi opencode CLI.
    // 1 attempt per provider (hemat token/waktu) — gagal = keep pending.
    let raw = null;
    let lastErr = null;
      // Mode split memakai 3 panggilan kecil (lihat blok di bawah), jadi panggilan
      // single-prompt yang besar harus DILEWATI. Kalau tidak, tiap artikel membuang
      // ~2 menit untuk panggilan yang sudah diketahui akan ditolak gate.
      if (opts.split) {
        console.log('  mode split: 3 panggilan kecil (intro+1+2 / 3+4 / faq)');
      } else if (process.env.GROQ_API_KEY && !process.env.SEO_CLI_ONLY) {
      try {
        console.log(`  [groq/${groqModel()}] call...`);
        const start = Date.now();
        const out = await runGroq({ model: groqModel(), system: SYSTEM_PROMPT, user });
        const ms = Date.now() - start;
        console.log(`  ${(ms / 1000).toFixed(1)}s OK out=${out.length}c`);
        if (process.env.SEO_DEBUG) writeFileSync('/tmp/seo-out.txt', out);
        raw = out;
      } catch (e) {
        lastErr = e.message;
        console.log(`  FAIL groq: ${e.message.slice(0, 120)} → fallback CLI`);
      }
    }
    for (let attempt = 0; !raw && !opts.split && attempt < 2; attempt++) {
      const model = nextModel();
      try {
        const fullPrompt = SYSTEM_PROMPT + '\n\n' + user;
        console.log(`  [${model}] call... prompt=${fullPrompt.length}chars`);
        // DEBUG: dump prompt for inspection
        if (process.env.SEO_DEBUG) {
          writeFileSync('/tmp/seo-prompt.txt', fullPrompt);
          writeFileSync('/tmp/seo-user.txt', user);
        }
        const start = Date.now();
        const out = await runOpencode({ model, prompt: fullPrompt });
        const ms = Date.now() - start;
        console.log(`  ${(ms / 1000).toFixed(1)}s OK out=${out.length}c`);
        if (process.env.SEO_DEBUG) writeFileSync('/tmp/seo-out.txt', out);
        raw = out;
        break;
      } catch (e) {
        lastErr = e.message;
        console.log(`  FAIL: ${e.message.slice(0, 100)}`);
      }
    }
      // ── mode split: 3 panggilan kecil untuk model gratis ────────────────────
      // Diuji 4 Okt: satu prompt 1200-1400 kata menghasilkan 1957-2924 karakter
      // (~400 kata) pada free model dan 0/4 artikel lolos gate. Model kecil tidak
      // sanggup satu tugas sebesar itu. Dipecah jadi 3 bagian + 1 bagian FAQ,
      // lalu dirakit. Lihat `buildPartPrompt` di prompts.ts.
      if (opts.split) {
        const ctx = {
          keyword: t.keyword,
          category: t.category || 'Lainnya',
          related,
          pricesBlock,
          localAnchor: t.local_anchor,
          localBuyer: t.local_buyer,
        };
        // Slug yang aman untuk link internal: hanya artikel PUBLISHED. Dipakai
        // fixBlogLinks untuk membuang link /blog/ karangan model ( Causes 404).
        const publishedForLinks = publishedSlugs();
        const parts = [];
        let splitOk = true;
        for (const part of ['intro+1+2', '3+4', 'faq']) {
          const pp = buildPartPrompt(part, ctx);
          let pout = null;
          for (let attempt = 0; !pout && attempt < 2; attempt++) {
            const model = nextModel();
            try {
              const full = SYSTEM_PROMPT + '\n\n' + pp;
              console.log(`  [split:${part}] [${model}] call...`);
              const st = Date.now();
              pout = await runOpencode({ model, prompt: full });
              console.log(`  [split:${part}] ${((Date.now() - st) / 1000).toFixed(1)}s OK out=${pout.length}c`);
            } catch (e) {
              console.log(`  [split:${part}] FAIL: ${e.message.slice(0, 90)}`);
            }
          }
          if (!pout) { splitOk = false; break; }
          if (process.env.SEO_DEBUG) writeFileSync(`/tmp/seo-split-${part.replace(/\W/g, '_')}.md`, pout);
          parts.push(pout);
        }
        if (!splitOk) {
          console.log('  FINAL FAIL (split) — keep pending');
          fail++;
          continue;
        }
        const [p1, p2, pfaqRaw] = parts;
        // Model gratis sering TIDAK menuruti prompt "hanya FAQ": ia menulis artikel
        // lengkap dulu (intro + 4 H2) lalu menaruh Q+A di paling akhir. Heading H2
        // di dalamnya membuat regex extractFaqFromBody terpotong di awal, sehingga
        // FAQ terbaca 0 walau Q+A-nya ada. Jadi bersihkan: buang semua heading dan
        // teks sebelum pertanyaan bernomor pertama.
        // SABR: model gratis sering tidak memberi format bernomor sama sekali —
        // itu penyebab kegagalan #1 ("FAQ hanya 0/5"). Coba beberapa bentuk berurutan:
        //   1) "1. pertanyaan" + "Jawaban: ..."     (format yang diminta prompt)
        //   2) "**pertanyaan**" + paragraf            (format yang FAQ lama pakai)
        //   3) "Q: ... / A: ..."
        //   4) bentuk bebas: baris berakhir "?" + baris berikutnya
        const cleanFaqPart = (s) => {
          const txt = String(s || '').replace(/^\s*#{1,6}\s.*$/gm, '');
          const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
          const out = [];
          // (1) bernomor
          let i = 0;
          while (i < lines.length && out.length < 5) {
            const m = lines[i].match(/^(\d{1,2})[.)]\s*(\S.*\?)\s*$/);
            if (m) {
              let a = '';
              if (i + 1 < lines.length && !/^\s*\d{1,2}[.)]\s/.test(lines[i + 1])) a = lines[++i];
              out.push({ q: m[2].trim(), a: (a || '').replace(/^jawaban\s*:\s*/i, '').trim() });
            }
            i++;
          }
          if (out.length >= 5) return out;
          // (2) bold question  (3) Q:/A:
          const bold = [];
          for (let k = 0; k < lines.length && bold.length < 5; k++) {
            const b2 = lines[k].match(/^\*\*(.+?\?)\*\*$/);
            const qa = lines[k].match(/^Q[:.]\s*(.+?\?)\s*$/i);
            const q = b2 ? b2[1] : qa ? qa[1] : null;
            if (q) {
              let a = lines[k + 1] || '';
              if (a && !a.endsWith('?') && !/^\d{1,2}[.)]\s/.test(a)) {
                bold.push({ q: q.trim(), a: a.replace(/^A[:.]\s*/i, '').trim() });
                k++;
              }
            }
          }
          for (const x of bold) {
            if (out.length >= 5) break;
            if (!out.some((y) => y.q.toLowerCase() === x.q.toLowerCase())) out.push(x);
          }
          if (out.length >= 5) return out;
          // (4) bentuk bebas: baris berakhir "?" lalu baris berikutnya
          for (let k = 0; k < lines.length - 1 && out.length < 5; k++) {
            if (lines[k].endsWith('?') && lines[k].length < 140) {
              const a2 = lines[k + 1];
              if (a2 && !a2.endsWith('?') && a2.length > 20 && !/^#/.test(a2)) {
                if (!out.some((y) => y.q.toLowerCase() === lines[k].toLowerCase()))
                  out.push({ q: lines[k].trim(), a: a2.replace(/^jawaban\s*:\s*/i, '').trim() });
                k++;
              }
            }
          }
          return out.slice(0, 5);
        };
        // Free model MELIHIBihi: diminta 2 H2 dia tulis 4-5, sehingga total H2 bisa 9
        // dan body 2518 kata (gate: 850-1400). Struktur JANGAN diserahkan ke model —
        // model menulis prosa, skrip memegang bentuk. Potong deterministik: sisakan
        // pembuka + 4 H2 pertama, buang sisanya. Dan batasi link eksternal max 2.
        const normalizeSplitBody = (s) => {
          const lines = String(s || '').split('\n');
          const h2At = [];
          for (let i = 0; i < lines.length; i++) {
            if (/^##\s+\S/.test(lines[i])) h2At.push(i);
          }
          const outLines = [];
          if (!h2At.length) return s;
          outLines.push(...lines.slice(0, h2At[0]));          // pembuka
          const keep = h2At.slice(0, 4);                     // 4 H2 pertama
          for (let k = 0; k < keep.length; k++) {
            const from = keep[k];
            const to = k + 1 < keep.length ? keep[k + 1] : lines.length;
            outLines.push(...lines.slice(from, to));
          }
          let out = outLines.join('\n');
          // link eksternal: sisakan maksimal 2
          const ext = [];
          out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (m, t, u) => {
            const host = (u.match(/https?:\/\/([^/]+)/) || [])[1] || '';
            const internal = /valleycity\.id/.test(host);
            if (internal) return m;
            ext.push(m);
            return ext.length <= 2 ? m : `[${t}]()`;
          });
          out = out.replace(/\n{3,}/g, '\n\n').trim();
          // Jaring pengaman panjang. Gate max 1400 kata; model gratis tulis 1600-2500.
          // Diukur 4 Okt: overhead assembler ~300 kata (price table, CTA, callout),
          // bukan 180 sepertiParking dikira awal — target 1120 berakhir di 1423 dan
          // 1431, gagal hanya oleh 23-31 kata. Target 1000 + 300 = 1300, aman.
          // Pangkas satu paragraf utuh dari belakang, tidak pernah tengah kalimat.
          const words = (t) => (String(t).match(/\b\w+\b/g) || []).length;
          if (words(out) > 1000) {
            const blines = out.split('\n');
            // Pertahankan KEPALA, pangkas dari ekor. Versi lama mengecek kata pada
            // slice(i) (ekor) sehingga memangkas hampir seluruh artikel dan H2
            // terakhir ikut hilang — hasil gegara H2 count = 2.
            let end = blines.length;
            while (end > 1 && words(blines.slice(0, end).join('\n')) > 1000) {
              let cut = end - 1;
              // jangan potong di tengah paragraf: mundur ke batas paragraf kosong
              while (cut > 1 && blines[cut - 1].trim() !== '') cut--;
              if (cut >= end - 1) cut = end - 1;
              // jangan buang blok struktural (heading/tabel/CTA/link money)
              if (cut > 1 && /^#{1,6}\s/.test(blines[cut] || '')) break;
              end = cut;
            }
            out = blines.slice(0, end).join('\n').replace(/\n{3,}/g, '\n\n').trim();
          }
          return out;
        };
        const faqPairs = cleanFaqPart(pfaqRaw);
        const faqPart = faqPairs.length
          ? faqPairs.map((f, i) => `${i + 1}. ${f.q}\nJawaban: ${f.a}`).join('\n\n')
          : '';
        const bodyClean = normalizeSplitBody(`${p1}\n${p2}`);
        // Free model SISIPKAN sampah non-Latin (terlihat di korpus: karakter CJK
        // akan menolak — itu benar, tapi untuk free model kejadian itu NORMAL, jadi
        // buang dulu deterministik:
        //   2. rapatkan spasi ganda yang timbul
        // Sisa kata Inggris masih ditangani retry di bawah.
        const stripNonLatin = (s) =>
          String(s)
            .replace(/[\u0100-\u017f\u0370-\u03ff\u0400-\u04ff\u0530-\u058f\u0900-\u0dff\u0e00-\u0fff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/ +([.,;:!?])/g, '$1');
        // Kata fungsi Inggris ("the", "of", "with", ...) TIDAK punya makna dalam
        // bahasa Indonesia, jadi menghapusnya tidak mungkin menghapus konten —
        // hanya membuang noise. Daftar sengaja sama persis dengan SISA_INGGRIS di
        // seo/lib/article-lint.mjs supaya gate dan pembersih sepakat.
        // Dua kebocoran free model yang murah diperbaiki:
        //  1) placeholder Liquid/Jekyll tak tersubstitusi -> `dan_what`, `dari_channel`
        //     (kata Indonesia + "_" + nama variabel). Underscore tidak pernah dipakai
        //     dalam prosa Indonesia, jadi membuang `[a-z]+_[a-z]+` tidak mungkin
        //     menghapus konten asli.
        //  2) model mengarang link /blog/<slug> yang tidak published ( Causes 404).
        //     Tulis ulang ke slug published pertama yang tersedia; kalau tidak ada,
        //     link dibuang tapi teksnya dipertahankan.
        // Model free kadang menulis garis horizontal `---` di tengah body. Itu
        // markdown horizontal rule, bukan frontmatter — tapi gate menghitung
        // `^---$` dan menyimpulkan "pagar = 3". Aman dibuang dari body.
        const stripStrayRules = (s) =>
          String(s).replace(/^---\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
        const stripLiquidJunk = (s) =>
          String(s).replace(/\b[a-z]{2,}_[a-z]{2,}\b/g, ' ').replace(/[ \t]{2,}/g, ' ');
        // Gate blogLinkBrokenInfo cocokkan pola BASAH `/blog/<slug>` (bukan bentuk
        // markdown lengkap), jadi bentuk absolut pun kena. Pakai pola yang sama
        // persis supaya tidak lolos dari [](...)-style.
        const fixBlogLinks = (s, valid) => {
          if (!valid || !valid.length) return s;
          const set = new Set(valid);
          return String(s)
            .replace(/\[([^\]]*)\]\((https?:\/\/valleycity\.id)?\/blog\/([a-z0-9][a-z0-9-]*)\/?\)/gi, (m, text, abs, slug) => {
              if (set.has(slug)) return m;
              const t = String(text).trim();
              return t ? t : '';
            })
            .replace(/https?:\/\/valleycity\.id\/blog\/([a-z0-9][a-z0-9-]*)\/?/gi, (m, slug) => (set.has(slug) ? m : ''));
        };
        const stripEnglishFn = (s) =>
          String(s)
            .replace(/\b(the|of|and|with|without|from|into|onto|upon|within|among|for|to|in|on|at|by|is|are|was|were|be|been|this|that|these|those|it|its|as|an|or|but|not|you|your|we|our|they|their|he|she|will|would|should|could|has|have|had|can|may|must|when|where|which|what|why|how|who)\b/gi, ' ')
            .replace(/\s+([.,;:!?])/g, '$1')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n');
        const clean = stripStrayRules(stripLiquidJunk(stripEnglishFn(stripNonLatin(bodyClean + `

## FAQ

` + faqPart))));
        raw = fixBlogLinks(clean, publishedForLinks);
        if (process.env.SEO_DEBUG) writeFileSync('/tmp/seo-out.txt', raw);
      }

    if (!raw) {
      console.log(`  FINAL FAIL — keep pending`);
      fail++;
      continue;
    }

      // Parse + assemble
      const llmBody = parseOutput(raw);
      const faq = extractFaqFromBody(llmBody);
    // A6: FAQ < 5 atau terindikasi hasil-pad = LLM tidak patuh. Dulu blok ini men-pad
    // dengan pertanyaan generik — sekarang artikel ditolak supaya korpus tetap bersih.
    if (faq.length < 5) {
      console.log(`  REJECT: FAQ hanya ${faq.length}/5 — tanpa pad generik`);
      fail++;
      continue;
    }
    const padReason = paddedFaqInfo(llmBody);
    if (padReason) {
      console.log(`  REJECT: FAQ ${padReason}`);
      fail++;
      continue;
    }
    const meta = deriveMeta({ keyword: t.keyword, llmBody, category: t.category || 'Lainnya' });

    let mdx = assembleMdx({
      llmBody,
      prices,
      moneyLink,
      related,
      faq,
      meta,
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

    const v = validateMdx(mdx, t.keyword);
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
    t.status = 'draft';
    t.notes = (t.notes || '') + ` | generated ${new Date().toISOString().slice(0, 10)}`;
    ok++;
  }

  if (ok > 0 && !opts.deferQueue) {
    writeFileSync(QUEUE_PATH, JSON.stringify(QUEUE, null, 2) + '\n');
    console.log(`\nWrote queue.json: ${ok} draft(s) added`);
  } else if (ok > 0) {
    console.log(`\n--defer-queue: Markdown tertulis, queue di-merge belakangan`);
  }
  console.log(`\nSummary: ${ok} ok, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});