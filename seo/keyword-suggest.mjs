#!/usr/bin/env node
/**
 * seo/keyword-suggest.mjs — kumpulkan keyword dari SEARCH SUGGESTION nyata.
 *
 * Kenapa bukan asal tebak keyword:
 * Suggestion autocomplete = yang benar-benar diketik orang. Ini proxy volume
 * yang gratis dan tidak perlu API berbayar (Google Keyword Planner butuh akun Ads
 * yang sudah spend). Relevansi Bing + subtype Google (512=QUERY, 22=COMPLETION,
 * 30=PERSON) dipakai sebagai sinyal INTENT, jadi kata ber-volume tapi salah
 * persona (mis. "apa itu NUP" → orang mau paham, belum tentu mau beli) bisa
 * diturunkan prioritasnya, bukan dibuang.
 *
 * SUMBER
 *   Google: suggestqueries.google.com/complete/search  (hl/gl = id-ID)
 *   Bing  : api.bing.com/osjson.aspx                  (market = id-ID)
 *
 * STRATEGI EKSPANSI (3 tingkat, semua gratis)
 *   L1  seed            → 1 query per seed, ambil 10 suggestion
 *   L2  abjad + terminator → seed + " a".."z", plus " … murah", " … di cimahi"
 *   L3  interrogatif   → "cara …", "apa itu …", "harga …" di tiap rung termakau
 *
 * OUTPUT
 *   `seo/keywords.suggested.json` — semua kandidat + skor, TIDAK langsung masuk
 *   antrean generate. Harvest itu murah; sekali item masuk `queue.json` jejaknya
 *   susah dibatalkan. Karena itu `--push` menyalin kandidat ke `keywords.json`
 *   dengan `approved: false` — manusia yang tetap satu-satunya yang bisa
 *   membukakan pintu ke antrean (lewat seed-queue.mjs setelah persetujuan).
 *
 * PEMAKAIAN
 *   node seo/keyword-suggest.mjs                     # harvest, tulis JSON
 *   node seo/keyword-suggest.mjs --push --min-score=20   # + usulkan ke keywords.json
 *   node seo/keyword-suggest.mjs --push --limit=300 --dry  # simulate
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, QUEUE_PATH, KEYWORDS_PATH, ROOT } from './paths.mjs';

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

// ── Seed: frasa yang memang diketik calon pembeli rumah di area ini ─────────
// Aturan kurasi yang sama dengan keywords.json: tiap seed harus punya halaman
// tujuan yang masuk akal di situs ini. Satu produk, satu lokasi — jadi seed
// yang tidak bisa dijawab /simulasi-kpr/, /nup/, /sale/, /agent/ atau artikel
// yang sudah ada tidak boleh masuk.
const SEEDS = [
  // inti: rumah + lokasi yang kita jual
  'rumah di cimahi', 'rumah di padalarang', 'perumahan di cimahi', 'perumahan padalarang',
  'rumah baru di cimahi', 'rumah murah di cimahi', 'perumahan di bandung barat',
  'rumah dekat bandung',
  // pembiayaan — halaman tujuannya /simulasi-kpr/
  'kpr rumah', 'cicilan rumah', 'simulasi kpr', 'dp rumah 0', 'kpr subsidi',
  'bunga kpr', 'tenor kpr', 'cicilan rumah 3 juta',
  // uang dan biaya — angka rekaman ada di homepage / nup
  'harga rumah di cimahi', 'booking fee rumah', 'bphtb rumah', 'biaya akad kpr',
  'nomor urut pemesanan', 'ppjb rumah',
  // proses — orang yang belum pernah beli
  'cara beli rumah', 'cara mengajukan kpr', 'apa itu nup rumah', 'syarat kpr',
  'sertifikat shm dan hgb', 'rumah tanpa dp',
  // lokasi & komut — pembeda kita: stasiun cepat + tol
  'rumah dekat stasiun padalarang', 'rumah dekat kcic', 'akses tol padalarang',
  'jarak padalarang bandung',
  // kemitraan — halaman tujuannya /agent/
  'agen properti cimahi', 'komisi agen properti', 'program agen properti',
  'jadi mitra perumahan',
];

// Kata yang menandai intent "cari tool/panel" — halaman ini yang paling
// Halaman ini yang paling tinggi convert dan paling dekat ke katalog.
// Intent beli di properti = orang menghitung uang atau mencari unitnya, bukan
// yang sedang mencari tahu definisi.
const INTENT_HIGH = /(kpr|cicil|angsur|dp\b|booking fee|nup\b|ppjb|bphtb|surat\b|denah|tipe\s?45|unit\b|dijual|harga|mitra|agen properti)/i;
const INTENT_LOW = /(\.com|\.id\b|png|jpg|template|font|template|musik|lagu|download|apk|admin|gratis$|wikipedia|arti|sejarah)/i;
// Area yang masuk akal untuk proyek ini: pasar kita komuter Bandung Barat +
// kota asal pembeli yang memang mencari rumah di koridor ini.
const GEO = /\b(cimahi|padalarang|bandung\s?barat|bandung|laksanamekar|baros|ngamprah|batujajar|cililin|soreang|cikalong\s?wetan|jawa\s?barat|jakarta|depok|bekasi|tangerang|bogor)\b/i;
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
// Sampah yang bukan maksud beli rumah sama sekali.
const JUNK = /\b(login|apk|template|wallpaper|job ?lowongan|loker|sewa\b|kontrakan\b|pindah\b|film|drakor|game|slot|judi)\b/i;
/** Negara non-Indonesia — pasar kita ID, jangan diburu. */
const NON_ID = /\b(malaysia|singapura|australia|india|filipina|thailand|vietnam|china|hong kong|arab|saudi|amerika|usa|inggris|uk|pakistan|bangladesh)\b/i;
/** Sewa/kontrak, bukan beli — tidak ada halaman tujuannya di situs ini. */
const AGENCY = /\b(sewa|kontrakan|ngontrak|kos|indekos|pulang\s?kampung|renovasi\s?murah)\b/i;
/** Suffix angka tanpa makna dari suggestion ("rumah di cimahi 1"). */
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

  // Pintu tunggal: kandidat masuk keywords.json sebagai approved:false dan
  // menunggu persetujuan manusia. queue.json bukan tempat buang hasil harvest.
  const kwDoc = existsSync(KEYWORDS_PATH)
    ? JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8'))
    : { _meta: {}, items: [] };
  kwDoc.items = kwDoc.items || [];
  const kwSlugs = new Set(kwDoc.items.map((i) => i.slug).filter(Boolean));
  let added = 0;
  for (const k of keep) {
    if (kwSlugs.has(k.slug) || queueSlugs.has(k.slug)) continue;
    kwDoc.items.push({
      keyword: k.keyword,
      slug: k.slug,
      category: k.category || 'panduan',
      intent: k.intent || null,
      cluster: k.cluster || null,
      priority: k.priority || 50,
      demand_signal: `suggest:${k.engines.join('+')}`,
      score: k.score,
      volume: k.volume,
      geo: k.geo || null,
      approved: false,
      suggested_at: new Date().toISOString(),
    });
    added++;
  }
  if (added) {
    kwDoc._meta.harvested_at = new Date().toISOString();
    writeFileSync(KEYWORDS_PATH, JSON.stringify(kwDoc, null, 2) + '\n');
  }
  console.log(`\n[suggest] ${added} kandidat masuk keywords.json dengan approved:false.`);
  console.log('[suggest] belum ada artikel yang dibuat. Alur sebenarnya:');
  console.log('[suggest]   1) review seo/keywords.json, set approved:true + _meta.approved_at');
  console.log('[suggest]   2) node seo/seed-queue.mjs   # baru masuk antrean generate');
}

main().catch((e) => {
  console.error('[suggest] FATAL:', e.message);
  process.exit(1);
});
