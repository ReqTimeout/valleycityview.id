#!/usr/bin/env node
/**
 * seo/mine-matrix.mjs — mining keyword MATRIKS: LOCAL × INTENT × INFO × suggestion.
 *
 * Matriks LOCAL (koridor Bandung Barat + sub-area) × INTENT (rumah/KPR/biaya/agen)
 * × INFO (cara/berapa/syarat/biaya/2026/terbaru) — tiap sel dipanen autocomplete
 * Google nyata, lalu dikembangkan LONG-TAIL rekursif:
 *   L1  grid INTENT×LOCAL + INTENT×LANDMARK + INFO×INTENT nasional
 *   L2  root pendek × (abjad a–z + terminator INFO)
 *   L3  root × interrogatif (cara/berapa/syarat/biaya/apakah/apa itu/tips)
 *   L4  suggestion teratas dipanen ULANG (suggestion-of-suggestion) → long-tail dalam
 *   Bing cross-check teratas → konfirmasi lintas engine
 *
 * PAGAR bisnis fail-closed (selaras curate-matrix): subsidi/bekas/sewa/kost, rumah
 * makan/sakit, pembiayaan Malaysia (johor/skim/faedah/belanjawan/kediaman), DP0 di
 * luar rekaman, kompetitor, geo luar pasar, waris/upacara/berita/konstruksi, event.
 *
 * OUTPUT: seo/keywords.mined.json (pool kandidat + bukti demand). Kurasi + approve
 * manusia tetap satu-satunya pintu ke antrean generate.
 *
 * PEMAKAIAN: node seo/mine-matrix.mjs [--conc=8] [--limit=2500]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, QUEUE_PATH, KEYWORDS_PATH, ROOT } from './paths.mjs';

const OUT_PATH = join(ROOT, 'seo/keywords.mined.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const argv = process.argv.slice(2);
const OPT = { conc: 8, limit: 2500 };
for (const a of argv) {
  if (a.startsWith('--conc=')) OPT.conc = parseInt(a.slice(7), 10) || 8;
  else if (a.startsWith('--limit=')) OPT.limit = parseInt(a.slice(8), 10) || 2500;
}

// ── Dimensi 1: LOCAL — koridor pasar + sub-area nyata ────────────────────────
const LOCAL = [
  'padalarang', 'cimahi', 'cimahi utara', 'cimahi selatan', 'cimahi tengah',
  'bandung barat', 'laksanamekar', 'baros', 'ngamprah', 'batujajar', 'cililin',
  'cikalong wetan', 'cipeundeuy', 'cipatat', 'bandung', 'jawa barat',
];
const LANDMARK = ['stasiun padalarang', 'kcic', 'whoosh', 'tol baros', 'unjani', 'kampus cimahi', 'stasiun whoosh', 'gerbang tol padalarang'];

// ── Dimensi 2: INTENT ────────────────────────────────────────────────────────
const INTENT = [
  'rumah', 'perumahan', 'harga rumah', 'harga perumahan', 'jual rumah', 'rumah dijual',
  'rumah murah', 'perumahan murah', 'rumah kpr', 'perumahan kpr', 'cicilan rumah', 'cicilan kpr',
  'rumah baru', 'perumahan baru', 'rumah siap huni', 'rumah tipe 45', 'harga rumah tipe 45',
  'denah rumah', 'booking fee rumah', 'nup rumah', 'dp rumah', 'dp kpr', 'kpr rumah',
  'kpr rumah pertama', 'rumah pertama', 'beli rumah', 'simulasi kpr', 'agen properti',
  'mitra perumahan', 'ppjb rumah', 'bphtb rumah', 'balik nama rumah', 'rumah cluster', 'rumah minimalis',
];

// ── Dimensi 3: INFO ──────────────────────────────────────────────────────────
const INFO = ['cara', 'berapa', 'apakah', 'syarat', 'biaya', 'apa itu', 'tips', 'panduan', 'perbedaan', 'terbaik', 'terdekat', 'terbaru', '2026', '2025', 'hari ini', 'sekarang', 'rekomendasi', 'perbandingan', 'untuk', 'sekitar'];
const INFO_TERMINATOR = ['murah', 'kpr', 'terbaru', 'siap huni', '500 jutaan', '3 jutaan', 'gaji 5 juta', 'minimalis', 'cluster', '2026', 'terdekat', 'ready stock'];
const INTERROGATIVE = ['cara', 'berapa', 'syarat', 'biaya', 'apakah', 'apa itu', 'tips', 'mengapa'];
const NASIONAL = ['rumah pertama', 'kpr rumah', 'rumah', 'booking fee rumah', 'nup rumah', 'bphtb', 'ppjb', 'dp rumah', 'cicilan rumah', 'rumah tipe 45'];

// ── Pagar konteks bisnis (fail-closed, selaras curate-matrix) ────────────────
const WRONG_PRODUCT = /\b(subsidi|second|bekas|sewa|kontrakan|ngontrak|kos\b|kost|indekos|renovasi)\b/i;
const NON_HOUSE = /\b(makan|sakit|restoran|resto|cafe|kafe|hotel|wisata|kuliner|penginapan|losmen|salon|spa\b|klinik|apotek|sekolah|masjid|gereja)\b/i;
const WRONG_COUNTRY = /\b(kwsp|lppsa|subsale|epf|socso|full\s?loan|maybank|cimb|rhb|public\s?bank|hong\s?leong|bank\s?islam|loan\s?agreement|strata|bumiputra|nak\b|kerajaan|loan\b|deposit\b|johor|skim|skema|melaka|penang|selangor|perak|sabah|sarawak|kedah|kelantan|terengganu|pahang|sembilan|bantuan\s?kasih|faedah|kediaman|belanjawan|hartanah|bumiputera|geran|ansuran|cagaran|gadai)\b/i;
const OFF_PRODUCT = /\bpeletakan\b|\bbatu\s?pertama\b|\bwaris\b|\bwali\s?kota\b|\bbupati\b|\bcepat\s?terjual\b|\bmenjual\s?rumah\b|\bcara\s?menjual\b|\bbangun\s?rumah\b|\bbiaya\s?bangun\b/i;
const OUT_GEO = /\b(jakarta|depok|tangerang|bogor|bekasi|cinere|jatinangor|banjaran|banjarnegara|semarang|surabaya|yogyakarta|solo|medan|makassar|denpasar|bali|malaysia|singapura|sukabumi|kuningan|garut|tasikmalaya|cirebon|subang|purwakarta|karawang|cianjur|bandung\s?kulon)\b/i;
const IN_GEO = /\b(cimahi|padalarang|bandung\s?barat|bandung|laksanamekar|baros|ngamprah|batujajar|cililin|cikalong\s?wetan|cipeundeuy|cipatat|jawa\s?barat)\b/i;
const COMPETITOR = /\b(summarecon|podomoro|malaya|g\s?land|citra\s?pesona|permata\s?cimahi|pharmindo|cipageran|cihanjuang|bukit\s?indah|nusa\s?hijau|ciuyah|pancanaka|grand\s?cimahi|pesona\s?alam|permana|amanda|emily|kbp|parahyangan|pondok\s?padalarang|mitra\s?dago|dago|antapani|kota\s?baru|regency|burgundy|rendeh|techno|valley\s?view|city\s?view|padalarang\s?indah|padalarang\s?valley|barukai|persada|bumi\s?baros)\b/i;
const PRICE_OUT = /\b([1-4]\d{2}|7\d{2}|[89]\d{2}|1\d{3})\s?(jutaan|juta|jt)\b/i;
const PRICE_MILYAR = /\b\d+([.,]\d+)?\s?(milyar|miliar|milliar)\b/i;
const CICILAN_OUT = /\b([12]|5|[6-9])\s?(jutaan|juta|jt)\b/i;
const DP0 = /\btanpa\s?dp\b|\bdp\s?0\b|\b0\s?dp\b|\bdp\s?nol\b|\btanpa\s?uang\s?muka\b/i;
const TRANSIENT = /\b(expo|pameran|bazaar|lelang|dilelang)\b/i;
const NONSENSE = /\bdi\s?dunia\b/i;
const JUNK = /\b(login|apk|template|wallpaper|lowongan|loker|film|drakor|game|slot|judi|download|gratis|free|olx|facebook|instagram|tiktok|foto|gambar|peta|maps)\b/i;
const QUESTION = /\b(apa|cara|mengapa|kenapa|bagaimana|apakah|berapa|mana|kapan)\b/i;
const INTENT_HIGH = /(kpr|cicil|angsur|dp\b|booking|nup\b|ppjb|bphtb|denah|tipe\s?45|unit\b|dijual|jual|harga|mitra|agen|simulasi|gaji|pertama|kcic|stasiun|tol\b|unjani|whoosh|cluster|minimalis)/i;
const DIFFERENTIATOR = /\b(kcic|stasiun|whoosh|tol|baros|unjani|komuter|kampus)\b/i;
const BRACKET = /\b(500 jutaan|600 juta|599|3 jutaan|4 juta|3 juta)\b/i;

const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);

async function fetchJSON(url, tries = 2) {
  for (let t = 0; t < tries; t++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9' }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (t === tries - 1) return null; await new Promise((r) => setTimeout(r, 400 * (t + 1))); }
  }
  return null;
}
async function google(q) {
  const d = await fetchJSON('https://suggestqueries.google.com/complete/search?client=firefox&hl=id&gl=id&q=' + encodeURIComponent(q));
  if (!d || !Array.isArray(d[1])) return [];
  return d[1].map((text, i) => ({ text: String(text ?? '').toLowerCase().trim(), volume: Math.max(0, 10 - i), engine: 'google', seed: q })).filter((x) => x.text);
}
async function bing(q) {
  const d = await fetchJSON('https://api.bing.com/osjson.aspx?market=id-ID&query=' + encodeURIComponent(q));
  if (!d || !Array.isArray(d[1])) return [];
  const rel = d[4]?.['google:suggestrelevance'] || [];
  const max = Math.max(1, ...rel);
  return d[1].map((text, i) => ({ text: String(text ?? '').toLowerCase().trim(), volume: Math.round(((rel[i] || 0) / max) * 100) / 10, engine: 'bing', seed: q })).filter((x) => x.text);
}
async function collect(queries, fn, conc) {
  const out = []; let i = 0;
  const runners = Array.from({ length: Math.max(1, conc) }, async () => {
    while (i < queries.length) { const r = await fn(queries[i++]); if (r && r.length) out.push(...r); }
  });
  await Promise.all(runners);
  return out;
}
function fence(text, slug, taken) {
  if (WRONG_PRODUCT.test(text)) return 'produk-salah';
  if (NON_HOUSE.test(text)) return 'bukan-rumah';
  if (WRONG_COUNTRY.test(text)) return 'pembiayaan-malaysia';
  if (OFF_PRODUCT.test(text)) return 'bukan-keputusan-beli-baru';
  if (JUNK.test(text)) return 'junk/navigasi';
  if (COMPETITOR.test(text)) return 'cluster-kompetitor';
  if (OUT_GEO.test(text)) return 'geo-luar-pasar';
  if (PRICE_OUT.test(text) || PRICE_MILYAR.test(text)) return 'bracket-harga-di-luar-rekaman';
  if (/\bcicilan\b/i.test(text) && CICILAN_OUT.test(text)) return 'bracket-cicilan-di-luar-rekaman';
  if (DP0.test(text)) return 'dp0-di-luar-rekaman';
  if (TRANSIENT.test(text)) return 'event/lelang-transient';
  if (NONSENSE.test(text)) return 'nonsense';
  if (taken.has(slug)) return 'tabrakan-slug';
  const w = text.split(/\s+/).filter(Boolean);
  if (w.length < 2) return 'terlalu-pendek';
  if (w.length > 9) return 'terlalu-panjang';
  if (!INTENT_HIGH.test(text) && !IN_GEO.test(text)) return 'tanpa-intent/geo';
  return null;
}
function score(text, engines, volume) {
  const w = text.split(/\s+/).filter(Boolean);
  let s = volume;
  if (engines.length > 1) s += 6;
  if (INTENT_HIGH.test(text)) s += 10;
  if (QUESTION.test(text)) s += 4;
  if (IN_GEO.test(text)) s += 7;
  if (DIFFERENTIATOR.test(text)) s += 6;
  if (BRACKET.test(text)) s += 5;
  if (/\b(harga|murah|terbaik|pertama|siap huni|terdekat|terbaru)\b/i.test(text)) s += 5;
  if (w.length >= 3) s += 5;
  if (w.length >= 4) s += 3;
  if (w.length >= 5) s += 2;
  return Math.round(s * 10) / 10;
}

async function main() {
  const blogSlugs = existsSync(BLOG_DIR) ? readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : [];
  const queue = existsSync(QUEUE_PATH) ? JSON.parse(readFileSync(QUEUE_PATH, 'utf8')) : { items: [] };
  const kwDoc = existsSync(KEYWORDS_PATH) ? JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8')) : { items: [] };
  const taken = new Set([...blogSlugs, ...(queue.items || []).map((i) => i.slug), ...(kwDoc.items || []).map((i) => i.slug)].filter(Boolean));

  // L1: grid INTENT×LOCAL + INTENT×LANDMARK + INFO×NASIONAL
  const l1q = [];
  for (const it of INTENT) for (const lo of LOCAL) l1q.push(`${it} ${lo}`);
  for (const it of INTENT) for (const lm of LANDMARK) l1q.push(`${it} dekat ${lm}`);
  for (const inf of INFO) for (const it of NASIONAL) l1q.push(`${inf} ${it}`);
  const uniqL1 = [...new Set(l1q)];
  console.log(`[matrix] L1 = ${uniqL1.length} query (INTENT ${INTENT.length} × LOCAL ${LOCAL.length} + landmark ${LANDMARK.length} + INFO ${INFO.length}×${NASIONAL.length})`);
  const l1 = await collect(uniqL1, google, OPT.conc);
  console.log(`[matrix] L1 → ${l1.length} suggestion`);

  // L2: root pendek × abjad + terminator
  const roots = new Set();
  for (const s of l1) { const w = s.text.split(/\s+/); if (w.length <= 3 && (IN_GEO.test(s.text) || INTENT_HIGH.test(s.text))) roots.add(s.text); }
  const rootArr = [...roots].slice(0, 160);
  const l2q = [];
  for (const r of rootArr.slice(0, 60)) for (const c of 'abcdefghijklmnopqrstuvwxyz') l2q.push(`${r} ${c}`);
  for (const r of rootArr) for (const t of INFO_TERMINATOR) l2q.push(`${r} ${t}`);
  const uniqL2 = [...new Set(l2q)];
  console.log(`[matrix] L2 = ${uniqL2.length} query (abjad 60 root + terminator ${rootArr.length} root)`);
  const l2 = await collect(uniqL2, google, OPT.conc);
  console.log(`[matrix] L2 → ${l2.length} suggestion`);

  // L3: interrogatif
  const l3q = [];
  for (const r of rootArr.slice(0, 90)) for (const q of INTERROGATIVE) l3q.push(`${q} ${r}`);
  const uniqL3 = [...new Set(l3q)];
  console.log(`[matrix] L3 = ${uniqL3.length} query (interrogatif)`);
  const l3 = await collect(uniqL3, google, OPT.conc);
  console.log(`[matrix] L3 → ${l3.length} suggestion`);

  // merge L1-L3
  const merged = new Map();
  const addAll = (arr) => { for (const s of arr) { if (!s.text.trim()) continue; if (!merged.has(s.text)) merged.set(s.text, { ...s, engines: [s.engine] }); else { const m = merged.get(s.text); m.volume = Math.max(m.volume, s.volume); if (!m.engines.includes(s.engine)) m.engines.push(s.engine); } } };
  addAll(l1); addAll(l2); addAll(l3);

  // L4: suggestion-of-suggestion — panen ulang root long-tail teratas
  const l4roots = [...merged.values()].filter((m) => IN_GEO.test(m.text) || INTENT_HIGH.test(m.text)).sort((a, b) => b.volume - a.volume).slice(0, 140).map((m) => m.text);
  console.log(`[matrix] L4 = ${l4roots.length} query (suggestion-of-suggestion)`);
  const l4 = await collect(l4roots, google, OPT.conc);
  addAll(l4);
  console.log(`[matrix] L4 → ${l4.length} suggestion`);

  // Bing cross-check teratas
  const topBing = [...merged.values()].sort((a, b) => b.volume - a.volume).slice(0, 300).map((m) => m.text);
  console.log(`[matrix] Bing cross-check ${topBing.length}`);
  const bRes = await collect(topBing, bing, OPT.conc);
  for (const b of bRes) { const m = merged.get(b.text); if (m) { if (!m.engines.includes('bing')) m.engines.push('bing'); m.volume = Math.max(m.volume, b.volume); } }

  // Pagar + skor
  const kept = []; const rejected = {};
  for (const c of merged.values()) {
    const slug = slugify(c.text);
    const reason = fence(c.text, slug, taken);
    if (reason) { rejected[reason] = (rejected[reason] || 0) + 1; continue; }
    kept.push({ keyword: c.text, slug, engines: c.engines, volume: Math.max(0, Math.round(c.volume * 10) / 10), score: score(c.text, c.engines, c.volume), geo: IN_GEO.test(c.text), question: QUESTION.test(c.text), seed: c.seed });
  }
  kept.sort((a, b) => b.score - a.score);
  const out = kept.slice(0, OPT.limit);
  const payload = {
    harvestedAt: new Date().toISOString(),
    method: 'matrix LOCAL×INTENT×INFO × Google/Bing suggestion long-tail (L1 grid + L2 abjad/terminator + L3 interrogatif + L4 suggestion-of-suggestion)',
    engines: ['google', 'bing'],
    dimensions: { local: LOCAL.length, landmark: LANDMARK.length, intent: INTENT.length, info: INFO.length },
    queries: { l1: uniqL1.length, l2: uniqL2.length, l3: uniqL3.length, l4: l4roots.length, bing: topBing.length },
    businessContext: { product: 'tipe 45/72 · KPR Rp 599 jt · cicilan Rp 3.871.000/bl · booking Rp 5 jt · tenor 20 th', location: 'Laksanamekar, Padalarang, Cimahi, Bandung Barat', differentiator: 'KCIC 15 mnt · Unjani 10 mnt · Tol Baros' },
    stats: { totalSuggestion: merged.size, kept: kept.length, written: out.length, rejected },
    items: out,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[matrix] total unik = ${merged.size}; lolos pagar = ${kept.length}; ditulis = ${out.length}`);
  console.log('[matrix] ditolak:', JSON.stringify(rejected));
  console.log(`[matrix] → ${OUT_PATH}\n[matrix] 25 teratas:`);
  out.slice(0, 25).forEach((i, n) => console.log(`  ${String(n + 1).padStart(2)}. ${String(i.score).padStart(5)} [${i.engines.join('+')}] ${i.keyword}`));
}
main().catch((e) => { console.error('[matrix] FATAL:', e.message); process.exit(1); });