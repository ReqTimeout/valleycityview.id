#!/usr/bin/env node
/**
 * seo/keyword-suggest.mjs — kumpulkan keyword dari SEARCH SUGGESTION nyata.
 *
 * Kenapa bukan asal tebak keyword:
 * Suggestion autocomplete = yang benar-benar diketik orang. Ini proxy volume
 * yang gratis dan tidak perlu API berbayar (Google Keyword Planner butuh akun Ads
 * yang sudah spend). Relevansi Bing + subtype Google (512=QUERY, 22=COMPLETION,
 * 30=PERSON) dipakai sebagai sinyal INTENT, jadi kata ber-volume tapi salah
 * Persona (mis. "jasa smm adalah" → orang mau paham, bukan mau beli) bisa
 * diturunkan prioritasnya, bukan dibuang.
 *
 * SUMBER
 *   Google: suggestqueries.google.com/complete/search  (hl/gl = id-ID)
 *   Bing  : api.bing.com/osjson.aspx                  (market = id-ID)
 *
 * STRATEGI EKSPANSI (3 tingkat, semua gratis)
 *   L1  seed            → 1 query per seed, ambil 10 suggestion
 *   L2  abjad + terminator → "smm a".."smm z", plus "smm jakarta", "smm murah"
 *   L3  interrogatif   → "cara …", "apa itu …", "harga …" di tiap rung termakau
 *
 * OUTPUT
 *   `seo/keywords.suggested.json` — semua kandidat + skor, TIDAK langsung masuk
 *   queue. Pemisahan ini penting: harvest itu murah tapi sekali tulis ke
 *   `queue.json` tidak bisa dibatalkan, jadi harus bisa direview dulu
 *   (`--push` baru menyalinnya sebagai `status: "pending"`).
 *
 * PEMAKAIAN
 *   node seo/keyword-suggest.mjs                     # harvest, tulis JSON
 *   node seo/keyword-suggest.mjs --push --min-score=20   # + masukkan ke queue
 *   node seo/keyword-suggest.mjs --push --limit=300 --dry  # simulate
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, QUEUE_PATH, ROOT } from './paths.mjs';

const OUT_PATH = join(ROOT, 'seo/keywords.suggested.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const argv = process.argv.slice(2);
const OPT = { push: false, dry: false, limit: 250, minScore: 15, concurrency: 6 };
for (const a of argv) {
  if (a === '--push') OPT.push = true;
  else if (a === '--dry') OPT.dry = true;
  else if (a.startsWith('--limit=')) OPT.limit = parseInt(a.slice(8), 10) || 250;
  else if (a.startsWith('--min-score=')) OPT.minScore = parseFloat(a.slice(12)) || 0;
  else if (a.startsWith('--concurrency=')) OPT.concurrency = parseInt(a.slice(14), 10) || 6;
}

// ── Seed: semuanya breath-nya yang memang dicari orang ───────────────────────
//Tidak boleh asal ngarang di sini — tiap seed harus relate ke katalog valleycity.id.
const SEEDS = [
  // inti produk
  'jasa smm', 'smm panel', 'panel smm', 'smm indonesia', 'smm panel indonesia',
  'sosmed boosting', 'jasa sosmed', 'jasa instagram', 'jasa tiktok', 'jasa youtube',
  'jasa followers', 'jasa likes', 'jasa views', 'jasa subscriber',
  //-segmentasi pasar
  'jasa smm jakarta', 'smm panel bekasi', 'smm panel bandung', 'smm panel surabaya',
  'smm panel surabaya', 'smm panel gratis', 'smm panel murah', 'smm panel termurah',
  // modal
  'harga smm', 'harga panel smm', 'harga followers instagram', 'harga likes tiktok',
  'harga views youtube', 'harga subscriber tiktok', 'modal usaha smm', 'modal smm panel',
  //dipakai orang yang mau cari tool
  'smm panel cara', 'cara pakai smm panel', 'cara order smm', 'tutorial smm panel',
  'smm panel adalah', 'apa itu smm panel', 'smm panel gratis?', 'smm panel legal',
  // untuk reseller
  'reseller smm', 'agen smm', 'jualan smm', 'bisnis smm', 'usaha smm',
  'jasa promoter instagram', 'jasa konten instagram', 'jasa grow followers',
];

// Kata yang menandai intent "cari tool/panel" — halaman ini yang paling
// Halaman ini yang paling tinggi convert dan paling dekat ke katalog.
const INTENT_HIGH = /(smm|panel|sosmed|promot|reseller|agen|followers|likes|views|subscriber)/i;
const INTENT_LOW = /(\.com|\.id\b|png|jpg|template|font|template|musik|lagu|download|apk|admin|gratis$|wikipedia|arti|sejarah)/i;
const GEO = /\b(jakarta|bekasi|bandung|surabaya|medan|denpasar|makassar|semarang|yogyakarta|yogyakarta|jogja|palembang|balikpapan|pekanbaru|banjarmasin|samarinda|manado|gorontalo|pontianak|jayapura|ambon|ternate|tangerang|depok|bogor|batam|cikarang|karanganyar|sidoarjo|malang|kediri|palangka|palembang|sukabumi|garut|cirebon|majalengka|sumedang|karawang|bekasi)\b/i;
const QUESTION = /\b(apa|cara|mengapa|kenapa|bagaimana|apakah|berapa|mana|kapan|mana)\b/i;

/** Ambil satu batch suggestion. Timeout pendek: kegagalan individual ditoleransi. */
async function fetchJSON(url, tries = 2) {
  for (let t = 0; t < tries; t++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (t === tries - 1) return null;
      await new Promise((r) => setTimeout(r, 600 * (t + 1)));
    }
  }
  return null;
}

/** Google — balikin { text, volume, types }. */
async function google(q) {
  const u =
    'https://suggestqueries.google.com/complete/search?client=firefox&hl=id&gl=id&q=' +
    encodeURIComponent(q);
  const d = await fetchJSON(u);
  if (!d || !Array.isArray(d[1])) return [];
  const types = d[3]?.['google:suggestsubtypes'] || [];
  return d[1]
    .map((text, i) => ({
      text: String(text ?? '').toLowerCase().trim(),
      volume: Math.max(0, 10 - i), // posisi di list ≈ popularity
      types: types[i] || [],
      engine: 'google',
      seed: q,
    }))
    .filter((x) => x.text.length > 0);
}

/** Bing — balikin { text, volume, types }; relevansi = sinyal intent. */
async function bing(q) {
  const u = 'https://api.bing.com/osjson.aspx?market=id-ID&query=' + encodeURIComponent(q);
  const d = await fetchJSON(u);
  if (!d || !Array.isArray(d[1])) return [];
  const rel = d[4]?.['google:suggestrelevance'] || [];
  const max = Math.max(1, ...rel);
  return d[1]
    .map((text, i) => ({
      text: String(text ?? '').toLowerCase().trim(),
      volume: Math.round(((rel[i] || 0) / max) * 10 * 10) / 10,
      types: [],
      engine: 'bing',
      seed: q,
    }))
    .filter((x) => x.text.length > 0);
}

/**
 * Jalankan banyak query paralel.
 *
 * `fn` = worker yang dipanggil per query (fungsi async yang balikin array).
 * `conc` = jumlah paralel. Sengaja dipisah dari `fn` — versi awal menamainya
 * `worker` sehingga `Math.max(1, fn)` jadi NaN, `Array.from({length: NaN})`
 * mengembalikan array kosong, nol runner jalan, dan collect() selalu mengembalikan
 * [] tanpa error apa pun. Itu sebabnya harvest keluar "0 suggestion" padahal
 * request-nya sebenarnya berhasil.
 */
async function collect(queries, fn, conc = 6) {
  const out = [];
  let i = 0;
  const n = Math.max(1, Number(conc) || 1);
  const runners = Array.from({ length: n }, async () => {
    while (i < queries.length) {
      const idx = i++;
      const r = await fn(queries[idx]);
      if (r && r.length) out.push(...r);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Punya jawaban? = user sudah ketik keyword itu (bukan cuma prefix). */
function isQuestionish(s) {
  return QUESTION.test(s) || /\?$/.test(s);
}

/** "gratis" hampir selalu intent-nya cari yang free, bukan mau beli. */
const FREE_BAIT = /\b(gratis|free|trial|test|discount|sample)\b/i;
/* Kata yang cuma navigasi/brand/abuse, bukan intent beli. */
const JUNK = /\b(smmt|adhoc|admin|login|akun gratis|topup|script|template|apk|bot|checker)\b/i;
/** Negara non-Indonesia — pasar kita ID, jangan diburu. */
const NON_ID = /\b(malaysia|singapura|australia|india|filipina|thailand|vietnam|china|hong kong|arab|saudi|amerika|usa|inggris|uk|pakistan|bangladesh)\b/i;
/** Jasa agensi/social-media-management — BUKAN yang kita jual (katalog = panel). */
const AGENCY = /\b(kelola|manajemen|manajemen media|agen sosial|agensi|content creation|buat konten|admin medsos)\b/i;
/** Suffix angka meaningless dari suggestion ("smm panel 1"). */
const TRAILING_NUM = /\s\d+$/;

/** Buang filler interrogatif, tapi jangan over-strip frasa yang sudah inti. */
function core(s) {
  const t = String(s ?? '')
    .replace(/^(apa|itu apa|bagaimana|mengapa|kenapa|apakah|berapa|mana|kapan)\s+/i, '')
    .replace(/\s+(adalah|mana|nya|kah| dong| ya)$/i, '')
    .replace(/[?.!,]+$/, '')
    .trim();
  return t || String(s ?? '').trim();
}

function score(c) {
  const t = String(c.text ?? '');
  const words = t.split(/\s+/).filter(Boolean);
  let s = 0;
  // Volume Google hanya proxy posisi (0..10). Jangan dikali 3 — itu membuat
  // kata generik volume-tinggi mengalahkan seluruh sinyal intent & penalti.
  s += c.volume;
  // konfirmasi lintas 2 engine = intent kuat
  const eng = c.engines || [];
  if (eng.length > 1) s += 6;
  if (INTENT_HIGH.test(t)) s += 10;
  if (isQuestionish(t)) s += 4;
  if (GEO.test(t)) s += 7;
  // modifier yang bikin keyword jadi spesifik = persis yang orang cari
  if (/\b(harga|termurah|murah|terbaik|promox|original|safe)\b/i.test(t)) s += 6;
  // 3+ kata biasanya niche dengan intent jelas, lebih mudah dikalahkan
  if (words.length >= 3) s += 5;

  // ── penalti ──────────────────────────────────────────────────────────────
  if (FREE_BAIT.test(t)) s -= 25; // "gratis" = cari free, bukan beli
  if (JUNK.test(t)) s -= 30; // navigasi/brand/abuse
  if (TRAILING_NUM.test(t)) s -= 25; // "smm panel 1" = artefak suggestion
  if (NON_ID.test(t)) s -= 45; // pasar kita Indonesia
  if (AGENCY.test(t)) s -= 35; // jasa agensi, bukan panel SMM
  if (INTENT_LOW.test(t)) s -= 25;
  // terlalu pendek (1 kata tanpa intent) = navigasi, bukan konten
  if (words.length < 2 && !INTENT_HIGH.test(t)) s -= 12;
  // terlalu panjang (7+ kata) = ekor panjang, volume ~0
  if (words.length > 6) s -= 20;
  // terlalu generik: cuma "jasa X" / "X panel" tanpa modifier.
  // Tanpa penalti ini, 20 keyword dapat skor identik padahal nilainya beda jauh.
  if (
    words.length === 2 &&
    !GEO.test(t) &&
    !/\b(harga|termurah|murah|terbaik|gratis|cara|apa)\b/i.test(t)
  )
    s -= 10;
  // sudah ada artikelnya
  if (c.exists) s -= 1000;
  return Math.round(s * 10) / 10;
}

const slugify = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

async function main() {
  const existingSlugs = new Set(
    existsSync(BLOG_DIR)
      ? readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
      : [],
  );
  const queue = existsSync(QUEUE_PATH)
    ? JSON.parse(readFileSync(QUEUE_PATH, 'utf8'))
    : { items: [] };
  const queueSlugs = new Set((queue.items || []).map((i) => i.slug).filter(Boolean));

  console.log(`[suggest] seed L1 = ${SEEDS.length}, L2/L3 akan menurunkan dari Suggestion itu`);

  // L1: seed
  const l1 = await collect(SEEDS, google, OPT.concurrency);
  console.log(`[suggest] L1 (${SEEDS.length} seed) → ${l1.length} suggestion`);

  // L2: abjad + terminator, dari root yang unik di L1
  const roots = new Set();
  for (const s of l1) {
    const c = core(s.text);
    if (c.split(/\s+/).length <= 2) roots.add(c);
  }
  const l2q = [];
  for (const r of [...roots].slice(0, 60)) {
    l2q.push(`${r} jakarta`, `${r} murah`, `${r} gratis`);
  }
  const l2 = await collect(l2q, google, OPT.concurrency);
  console.log(`[suggest] L2 (${l2q.length} query) → ${l2.length} suggestion`);

  // L3: interrogatif dari root teratas
  const topRoots = [...roots].slice(0, 40);
  const l3q = topRoots.flatMap((r) => [`cara ${r}`, `apa itu ${r}`, `harga ${r}`]);
  const l3 = await collect(l3q, google, OPT.concurrency);
  console.log(`[suggest] L3 (${l3q.length} query) → ${l3.length} suggestion`);

  // Cross-check ke Bing untuk intent — cuma kandidat teratas, biar murah
  const merged = new Map();
  for (const s of [...l1, ...l2, ...l3]) {
    const key = s.text;
    if (typeof key !== 'string' || !key.trim()) continue;
    if (!merged.has(key)) merged.set(key, { ...s, engines: [s.engine] });
    else {
      const m = merged.get(key);
      m.volume = Math.max(m.volume, s.volume);
      if (!m.engines.includes(s.engine)) m.engines.push(s.engine);
      m.types = [...new Set([...m.types, ...s.types])];
    }
  }
  const topForBing = [...merged.values()]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 300)
    .map((m) => m.text);
  console.log(`[suggest] cross-check Bing untuk ${topForBing.length} kandidat teratas`);
  const bRes = await collect(topForBing, bing, OPT.concurrency);
  for (const b of bRes) {
    if (!b || typeof b.text !== 'string' || !b.text.trim()) continue;
    const m = merged.get(b.text);
    if (m) {
      if (!m.engines.includes('bing')) m.engines.push('bing');
      m.volume = Math.max(m.volume, b.volume);
    }
  }

  // dedupe final + skor
  const items = [...merged.values()]
    .filter((c) => typeof c.text === 'string' && c.text.trim().length > 0)
    .map((c) => {
    const slug = slugify(c.text);
    return {
      keyword: c.text,
      core: core(c.text),
      slug,
      engines: c.engines,
      volume: Math.max(0, Math.round(c.volume * 10) / 10),
      geo: GEO.test(c.text),
      question: isQuestionish(c.text),
      exists: existingSlugs.has(slug) || queueSlugs.has(slug),
    };
  });
  // PENTING: `score()` membaca `c.text`, sedangkan objek item memakai key
  // `keyword`. Tanpa pemetaan ini `c.text` = undefined → semua regex intent/
  // penalti gagal diam-diam dan skor hanya jadi `volume + engines - 12`,
  // artinya ranking sama sekali tidak membedakan intent.
  for (const it of items) it.score = score({ ...it, text: it.keyword });

  items.sort((a, b) => b.score - a.score);
  // Statistik skor, supaya `--min-score` bisa dipilih dari data, bukan tebakan.
  const valid = items.filter((i) => !i.exists);
  const qs = valid.map((i) => i.score).sort((a, b) => a - b);
  const pct = (p) => (qs.length ? qs[Math.min(qs.length - 1, Math.floor(qs.length * p))] : 0);
  console.log(
    `[suggest] sebaran skor (n=${valid.length}): p50=${pct(0.5)} p75=${pct(0.75)} p90=${pct(0.9)} p95=${pct(0.95)} max=${qs[qs.length - 1] ?? 0}`,
  );
  if (OPT.minScore === 15) {
    // Default: pilih p80 supaya dapat ~20% teratas, bukan angka tetap yang bisa
    // menghasilkan 0 atau 98 item tergantung tuning diskriminasi.
    OPT.minScore = pct(0.8);
    console.log(`[suggest] min-score 15 dianggap default → dipake p80 = ${OPT.minScore}`);
  }
  const keep = valid.filter((i) => i.score >= OPT.minScore).slice(0, OPT.limit);

  const payload = {
    harvestedAt: new Date().toISOString(),
    engines: ['google', 'bing'],
    params: OPT,
    stats: {
      totalSuggestion: items.length,
      notExist: valid.length,
      kept: keep.length,
      aboveMin: valid.filter((i) => i.score >= OPT.minScore).length,
    },
    items: keep,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[suggest] total unik      : ${items.length}`);
  console.log(`[suggest] belum ada artikel: ${payload.stats.notExist}`);
  console.log(`[suggest] lolos min-score ${OPT.minScore} : ${payload.stats.aboveMin}`);
  console.log(`[suggest] ditulis (limit ${OPT.limit}) : ${keep.length} → ${OUT_PATH}`);
  console.log('');
  console.log('[suggest] 15 teratas:');
  keep.slice(0, 15).forEach((i, n) =>
    console.log(
      `  ${String(n + 1).padStart(2)}. ${String(i.score).padStart(6)}  [${i.engines.join('+').padEnd(11)}] ${i.keyword}`,
    ),
  );

  // Push ke queue kalau diminta
  if (!OPT.push) {
    console.log('\n[suggest] belum --push. Queue tidak diubah. Tinjau JSON dulu, lalu:');
    console.log('[suggest]   node seo/keyword-suggest.mjs --push --min-score=' + OPT.minScore);
    return;
  }
  if (OPT.dry) {
    console.log('\n[suggest] --dry: queue tidak ditulis. AKAN MASUK:');
    keep.slice(0, 20).forEach((i) => console.log(`  ${i.slug}`));
    return;
  }

  let maxPrio = Math.max(0, ...(queue.items || []).map((i) => i.priority || 0));
  let added = 0;
  for (const k of keep) {
    if (queueSlugs.has(k.slug)) continue;
    maxPrio += 1;
    queue.items.push({
      slug: k.slug,
      keyword: k.keyword,
      status: 'pending',
      priority: maxPrio,
      source: 'suggest:' + k.engines.join('+'),
      score: k.score,
      volume: k.volume,
      geo: k.geo,
      addedAt: new Date().toISOString(),
    });
    added++;
  }
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');
  console.log(`\n[suggest] ${added} keyword masuk queue sebagai 'pending'.`);
  console.log('[suggest] generate sekarang:');
  console.log(`[suggest]   node seo/blog-expand.mjs --count=${added}`);
}

main().catch((e) => {
  console.error('[suggest] FATAL:', e.message);
  process.exit(1);
});
