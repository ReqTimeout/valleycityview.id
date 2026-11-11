#!/usr/bin/env node
/**
 * seo/qc-uniqueness.mjs — GATE anti-duplicate / anti-scaled-content-abuse.
 *
 * Kenapa file ini terpisah dari `seo/qc.mjs`:
 *   qc.mjs = cek per-draft (Markdown valid, FAQ, broken link) saat menulis manual.
 *   qc-uniqueness = **gate kelulusan** yang dijalankan sebelum publish untuk SET
 *   seluruh corpus (draft + published + file .md liar). Yang paling berbahaya
 *   bukan satu draft mirip satu draft, tapi 1.015 artikel queue yang semuanya
 *   template sama — itu yang bikin Google menandai scaled content abuse.
 *
 * Cara kerja (zero dependency):
 *   1. Ambil corpus Markdown, baca `title` + body (buang frontmatter, link syntax,
 *      URL, blok kode, dan stopword ID).
 *   2. shingles 4-token → cosine similarity pada term-frekuensi (TF cosine).
 *      TF-cosinus lebih tahan noise daripada Jaccard mentah yang dipakai qc.mjs
 *      (Jaccard 0.55 di sana sudah longgar untuk teks pendek).
 *   3. Tabrakan exact: slug duplikat, title duplikat (case/trim-normalized).
 *   4. Klaster: bandingkan juga di dalam `cluster` yang sama dari queue.json —
 *      dua artikel di klaster sama wajib beda, dua artikel lintas klaster boleh
 *      mirip (mis. dua panduan "cara order" untuk platform berbeda).
 *
 * Ambang (bisa diubah CLI; default arose dari sebaran corpus saat ini):
 *   --fail     0.62  similarity ≥ ini = FAIL (blokir publish)
 *   --warn     0.48  ≥ ini = WARN (tapi tidak memblokir, tetap catat)
 *
 * Exit code: 0 = tidak ada FAIL, 1 = ada FAIL (jangan publish), 2 = error tool.
 *
 * Usage:
 *   node seo/qc-uniqueness.mjs                  # audit seluruh corpus
 *   node seo/qc-uniqueness.mjs --slug x --slug y # hanya slug tertentu (pre-publish)
 *   node seo/qc-uniqueness.mjs --json           # output JSON untuk CI/notif
 *   node seo/qc-uniqueness.mjs --fail 0.7 --warn 0.5
 *   node seo/qc-uniqueness.mjs --top 20         # tampilkan N pasangan terunik
 *   node seo/qc-uniqueness.mjs --strict-cluster # FAIL hanya jika 1 klaster sama?
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, QUEUE_PATH, CITIES_PATH } from './paths.mjs';
import { hasGeoAnchor, anchorProbe } from './lib/geo-anchor.mjs';

const NL = String.fromCharCode(10);

/** Stopword Indonesia + Inggris — supaya kata sambung tidak menggotong-or-menggotong naikkan similarity. */
const STOPWORDS = new Set(
  `ada adalah agar akan atau bagi bahwa banyak beberapa belum berada bila bisa buat dan dalam dari dengan di dia dll dua hanya harus
   ingin ini itu jadi jangan jika juga kalau kami kamu karena ke kemudian kepada kita lagi lain lalu lebih maka masih mau melakukan
   melalui memang mereka merupakan meski mungkin namun nya oleh pada padahal paling para pernah pula pun saat saja sama sampai sangat
   saya sebagai sebuah sedang sehingga sejak sekarang selain seluruh semua sendiri seorang sepanjang seperti serta sesuatu setiap
   sudah supaya tak tanpa tapi telah tentang terhadap terlalu tersebut tetapi tiap tidak untuk yaitu yakni yang
   a an and are as at be but by for from has have if in into is it its of on or that the this to was were will with
   you your we our they them their can could would should may might do does done get got`
    .split(/\s+/)
    .filter(Boolean)
);

/** Kata kunci yang justru penting untuk niche SMM (jangan dibuang). */
const KEEP = /^(smm|panel|reseller|follower|followers|likes|view|views|subscribers|tiktok|instagram|youtube|telegram|spotify|facebook|twitter|reels|story|comment|komentar|share|shares|save|saves|like|menambah|harga|modal|profit|untung|jual|beli)$/i;

let ARGS;
try {
  ARGS = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`qc-uniqueness: ${e.message}`);
  console.error(fs_usage());
  process.exitCode = 2;
  process.exit(process.exitCode); // aman: belum menulis output besar
}
if (ARGS.help) {
  console.log(fs_usage());
}

function parseArgs(argv) {
  const a = { fail: 0.62, warn: 0.48, top: 15, slugs: [], json: false, strictCluster: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fail') a.fail = Number(argv[++i]);
    else if (k === '--warn') a.warn = Number(argv[++i]);
    else if (k === '--top') a.top = Number(argv[++i]);
    else if (k === '--slug') a.slugs.push(argv[++i]);
    else if (k === '--json') a.json = true;
    else if (k === '--strict-cluster') a.strictCluster = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Argumen tidak dikenal: ${k}`);
  }
  if (!Number.isFinite(a.fail) || !Number.isFinite(a.warn) || a.warn > a.fail) {
    throw new Error(`Ambang tidak valid: --warn (${a.warn}) harus <= --fail (${a.fail})`);
  }
  return a;
}

function fs_usage() {
  return [
    'Usage: node seo/qc-uniqueness.mjs [--slug s]... [--fail T] [--warn T] [--top N] [--json] [--strict-cluster]',
    `  --slug S          audit hanya slug ini (ULANGI untuk beberapa). Kosong = seluruh corpus.`,
    `  --fail T          similarity >= T = FAIL (default ${0.62})`,
    `  --warn T          similarity >= T = WARN (default ${0.48})`,
    `  --top N           tampilkan N pasangan terunik (default 15)`,
    `  --json            output JSON (CI / notifikasi)`,
    `  --strict-cluster  hanya FAIL kalau dua slug berada di cluster yang sama`,
  ].join(NL);
}

/** Ambil field frontmatter sederhana (title/draft/cluster/category). */
function frontmatter(src) {
  const m = src.match(/^---[\s\S]*?\r?\n---/);
  const fm = m ? m[0] : '';
  const get = (k) => {
    const hit = fm.match(new RegExp('^' + k + ':[ \t]*"?([^"\\n]*)"?', 'm'));
    return hit ? hit[1].trim() : '';
  };
  return {
    title: get('title'),
    category: get('category'),
    draft: /^status:[ \t]*draft/m.test(fm),
    body: m ? src.slice(m[0].length) : src,
  };
}

function bodyOnly(src) {
  const m = src.match(/^---[\s\S]*?\r?\n---/);
  return m ? src.slice(m[0].length) : src;
}

/** Bersihkan teks: buang frontmatter, kode, link syntax, URL, markdown, angka murni. */
function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!??\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_~|{}\[\]()=+\-]/g, ' ')
    .replace(/\b\d[\d.,]*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .map((w) => w.replace(/[.]+$/, ''))
    .filter((w) => w.length >= 3 && (!STOPWORDS.has(w) || KEEP.test(w)));
}

/** TF map kata → count (dokumen pendek, IDF tidak perlu). */
function termFreq(text) {
  const tf = new Map();
  for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** Cosinus antara dua TF map. 0..1 */
function cosine(tfA, tfB) {
  if (!tfA.size || !tfB.size) return 0;
  let dot = 0;
  const [small, big] = tfA.size <= tfB.size ? [tfA, tfB] : [tfB, tfA];
  for (const [w, c] of small) {
    const d = big.get(w);
    if (d) dot += c * d;
  }
  if (!dot) return 0;
  let na = 0;
  let nb = 0;
  for (const c of tfA.values()) na += c * c;
  for (const c of tfB.values()) nb += c * c;
  return dot / Math.sqrt(na * nb);
}

/** Overlap kata exact (untuk Collision signal kedua selain cosine). */
function keywordOverlap(tfA, tfB) {
  let inter = 0;
  const [small, big] = tfA.size <= tfB.size ? [tfA, tfB] : [tfB, tfA];
  for (const w of small.keys()) if (big.has(w)) inter++;
  return small.size ? inter / small.size : 0;
}

/** shingles 4 kata → Jaccard (pelengkap cosine: menangkap urutan identik). */
function shingles(text, n = 4) {
  const w = tokenize(text);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
}
function jaccardSet(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Susun corpus dari disk + queue (cluster map). */
/**
 * Peta slug-kota untuk deteksi artikel geo. `cities.json` adalah satu-satunya
 * sumber nama kota yang sahih (72 kota, 33 provinsi) — nama kota disisipkan ke
 * dalam artikel sebagai fakta ekonomi lokal, TIDAK sekadar mengganti nama kota
 * di templat yang sama (lihat §14.13).
 */
function loadCityMap() {
  if (!existsSync(CITIES_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(CITIES_PATH, 'utf8'));
    const list = Array.isArray(raw.cities) ? raw.cities : Object.values(raw.cities || {});
    const bySlug = new Map();
    for (const c of list) if (c && c.slug) bySlug.set(c.slug, c);
    return bySlug;
  } catch {
    return new Map();
  }
}

function detectCity(slug, cityMap) {
  if (!cityMap.size) return null;
  for (const cs of [...cityMap.keys()].sort((a, b) => b.length - a.length)) {
    if (slug === cs || slug.endsWith('-' + cs)) return cityMap.get(cs);
  }
  return null;
}

function loadCorpus() {
  if (!existsSync(BLOG_DIR)) return { items: [], clusterOf: new Map() };
  const cityMap = loadCityMap();
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));
  const items = files.map((f) => {
    const slug = f.replace(/\.md$/, '');
    const src = readFileSync(join(BLOG_DIR, f), 'utf8');
    const { title, category, draft, body } = frontmatter(src);
    // judul ikut di-vektor: judul yang sama persis juga tanda artikel spam.
    const text = `${title} . ${body}`;
    const city = detectCity(slug, cityMap);
    return {
      slug,
      title,
      category,
      draft,
      words: tokenize(body).length,
      tf: termFreq(text),
      sh: shingles(text),
      geo: city ? { city: city.city, province: city.provinsi, tier: city.tier } : null,
      hasAnchor: city ? hasGeoAnchor(body, city.anchor) : null,
    };
  });
  // cluster dari queue.json (kalau ada)
  const clusterOf = new Map();
  if (existsSync(QUEUE_PATH)) {
    try {
      const q = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
      for (const it of q.items || []) {
        if (!it.slug) continue;
        clusterOf.set(it.slug, it.cluster || it.category || it.keyword || '');
      }
    } catch (e) {
      // queue rusak bukan alasan gagal gate ini
    }
  }
  return { items, clusterOf };
}

/**
 * Prefilter untuk skala: cosine penuh itu mahal (O(n^2 * vocab)). 1.000 file =
 * 1,1 juta pasang. Jadi pakai inverted index atas token langga (df kecil):
 * dua dokumen yang berbagi token langka layak dibandingkan; yang tidak sama
 * sekali pasti tidak mirip dan dilewati tanpa cosine.
 */
function candidatePairs(items, topN = 12) {
  const df = new Map();
  const topTokens = items.map((it) => {
    const arr = [...it.tf.entries()].sort((x, y) => y[1] - x[1]).slice(0, topN * 3).map(([w]) => w);
    for (const w of arr) df.set(w, (df.get(w) || 0) + 1);
    return arr.slice(0, topN);
  });
  const tokenToDocs = new Map();
  items.forEach((_, idx) => {
    for (const w of topTokens[idx]) {
      if (!tokenToDocs.has(w)) tokenToDocs.set(w, []);
      tokenToDocs.get(w).push(idx);
    }
  });
  // Token umum (df besar) tetap dipakai, tapi DIBATAS 40 dokumen per token
  // (diurutkan slug supaya deterministik). Alasannya: kalau token umum di-skip
  // total, korpus homogen — justru kasus scaled-content-abuse yang paling
  // ingin kita tangkap — akan lolos tanpa pasangan apa pun (terbukti di uji
  // 1.000 file: 0 pasang padahal jelasNear-duplicate semua).
  const MAX_DOCS_PER_TOKEN = 40;
  const seen = new Set();
  const out = [];
  let truncated = 0;
  for (const [, idxsRaw] of tokenToDocs) {
    let idxs = idxsRaw;
    if (idxs.length > MAX_DOCS_PER_TOKEN) {
      truncated++;
      idxs = idxsRaw
        .slice()
        .sort((x, y) => (items[x].slug < items[y].slug ? -1 : 1))
        .slice(0, MAX_DOCS_PER_TOKEN);
    }
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const key = idxs[i] * items.length + idxs[j];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([idxs[i], idxs[j]]);
      }
    }
  }
  return { pairs: out, truncatedTokens: truncated };
}

function sameCluster(a, b, clusterOf) {
  const ca = (clusterOf.get(a.slug) || a.category || '').toLowerCase();
  const cb = (clusterOf.get(b.slug) || b.category || '').toLowerCase();
  return ca && cb && ca === cb;
}

function main() {
  const { items, clusterOf } = loadCorpus();
  if (!items.length) {
    console.error(`qc-uniqueness: tidak ada Markdown di ${BLOG_DIR}`);
    process.exitCode = 2;
    return;
  }

  const targets = ARGS.slugs.length ? items.filter((i) => ARGS.slugs.includes(i.slug)) : items;
  const missing = ARGS.slugs.filter((s) => !items.some((i) => i.slug === s));
  if (missing.length) {
    console.error(`qc-uniqueness: slug tidak ditemukan: ${missing.join(', ')}`);
    process.exitCode = 2;
    return;
  }
  const others = ARGS.slugs.length ? items.filter((i) => !ARGS.slugs.includes(i.slug)) : items;

  // 1) exact collisions
  const byTitle = new Map();
  const titleCollisions = [];
  for (const it of items) {
    const key = normalize(it.title);
    if (!key) continue;
    if (byTitle.has(key)) titleCollisions.push([byTitle.get(key), it.slug, key]);
    else byTitle.set(key, it.slug);
  }

  // 2) pairwise similarity — hanya lewat kandidat prefilter, tiap pasang dihitung
  //    SATU KALI (a !== b, tanpa duplikasi simetris A-B dan B-A).
  const targetSet = new Set(targets.map((t) => t.slug));
  const seenPair = new Set();
  const pairs = [];

  const pre = candidatePairs(items);
  for (const [i, j] of pre.pairs) {
    const a = items[i];
    const b = items[j];
    if (a.slug === b.slug) continue; // JANGAN bandingkan file dengan dirinya sendiri
    if (targetSet.size && !targetSet.has(a.slug) && !targetSet.has(b.slug)) continue;

    const cos = cosine(a.tf, b.tf);
    if (cos < ARGS.warn) continue; // short-circuit sebelum hitung mahal lain
    const key = a.slug < b.slug ? `${a.slug}|${b.slug}` : `${b.slug}|${a.slug}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);

    const jac = jaccardSet(a.sh, b.sh);
    const ovl = keywordOverlap(a.tf, b.tf);
    // skor gabungan: cosine dominan, shingle & overlap sebagai penguat.
    const score = cos * 0.6 + jac * 0.25 + ovl * 0.15;
    pairs.push({
      score: Number(score.toFixed(4)),
      cosine: Number(cos.toFixed(4)),
      jaccard4: Number(jac.toFixed(4)),
      overlap: Number(ovl.toFixed(4)),
      sameCluster: sameCluster(a, b, clusterOf),
      a: a.slug < b.slug ? a.slug : b.slug,
      b: a.slug < b.slug ? b.slug : a.slug,
    });
  }
  pairs.sort((x, y) => y.score - x.score);

  const fails = pairs.filter((p) => p.score >= ARGS.fail && (!ARGS.strictCluster || p.sameCluster));
  const warns = pairs.filter((p) => p.score < ARGS.fail && p.score >= ARGS.warn);
  const exactFails = titleCollisions.map(([x, y, key]) => ({ a: x, b: y, title: key }));

  const summary = {
    corpusSize: items.length,
    audited: targets.length,
    thresholds: { fail: ARGS.fail, warn: ARGS.warn },
    strictCluster: ARGS.strictCluster,
    fails: fails.length,
    warns: warns.length,
    titleCollisions: exactFails.length,
    pairs,
    titleCollisionsDetail: exactFails,
    failsDetail: fails,
    warnsDetail: warns,
  };

  if (ARGS.json) {
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = fails.length + exactFails.length ? 1 : 0;
    return;
  }

  // human output
  console.log(`qc-uniqueness — korpus ${items.length} Markdown, diaudit ${targets.length}`);

  // Status anchor kota untuk artikel geo (anti-doorway, §14.13).
  const geoItems = targets.filter((i) => i.geo);
  if (geoItems.length) {
    const ada = geoItems.filter((i) => i.hasAnchor).length;
    const tanpa = geoItems.length - ada;
    const tanpaSlug = targets.filter((i) => i.geo && !i.hasAnchor).slice(0, 6).map((i) => i.slug);
    console.log(
      `  anchor kota: ${ada}/${geoItems.length} memuat fakta ekonomi lokal${tanpa ? ` · ${tanpa} TANPA anchor${tanpaSlug.length ? ` (${tanpaSlug.join(', ')}${tanpa > tanpaSlug.length ? ', …' : ''})` : ''}` : ' ✓'}`,
    );
    if (tanpa) {
      console.log('    catatan: tanpa anchor = konten antar-kota nyaris identik (risiko doorway page).');
      console.log('    ثابت: `seo/lib/geo-anchor.mjs` menyuntik anchor saat generate. Jalankan ulang generate untuk artikel geo.');
    }
  }
  console.log(`  ambang: FAIL >= ${ARGS.fail} · WARN >= ${ARGS.warn}${ARGS.strictCluster ? ' · strict-cluster ON' : ''}`);
  if (pre.truncatedTokens) {
    console.log(`  catatan : ${pre.truncatedTokens} token umum di-cap 40 dokumen/pasang (korpus homogen — ini justru sinyal duplicate)`);
  }
  console.log(`  hasil : ${fails.length} FAIL · ${warns.length} WARN · ${exactFails.length} title duplikat\n`);

  if (exactFails.length) {
    console.log('TITLE DUPLIKAT (FAIL):');
    for (const c of exactFails) console.log(`  · "${c.title}" → ${c.a} ⇄ ${c.b}`);
    console.log('');
  }

  if (fails.length) {
    console.log('PASANGAN FAIL (jangan publish, artikel terlalu mirip):');
    for (const p of fails.slice(0, ARGS.top)) {
      console.log(`  · ${p.a} ⇄ ${p.b}  score=${p.score} (cos=${p.cosine} jac4=${p.jaccard4} ovl=${p.overlap}) klaster sama=${p.sameCluster ? 'ya' : 'tidak'}`);
    }
    if (fails.length > ARGS.top) console.log(`  … +${fails.length - ARGS.top} pasang lagi (--top untuk lihat semua)`);
    console.log('');
  }

  if (warns.length) {
    console.log(`WARN (boleh, tapi perhatikan):`);
    for (const p of warns.slice(0, ARGS.top)) {
      console.log(`  · ${p.a} ⇄ ${p.b}  score=${p.score} klaster sama=${p.sameCluster ? 'ya' : 'tidak'}`);
    }
    if (warns.length > ARGS.top) console.log(`  … +${warns.length - ARGS.top} pasang lagi`);
    console.log('');
  }

  const blocked = fails.length + exactFails.length;
  if (blocked) {
    console.log(`GATE: FAIL (${blocked}) — jangan publish slug tersebut sebelum dirombak / digabung.`);
    process.exitCode = 1;
    return;
  }
  console.log('GATE: PASS — corpus cukup unik untuk publish.');
}

try {
  main();
} catch (e) {
  console.error('qc-uniqueness FATAL:', e.message);
  process.exit(2);
}
