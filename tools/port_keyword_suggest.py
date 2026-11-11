#!/usr/bin/env python3
"""Fase 10b — keyword-suggest.mjs jadi alat riset properti, bukan SMM.

Dua hal yang salah kalau ditinggal:
  1. Seed + INTENT_HIGH + GEO + JUNK + AGENCY masih vocabulary panel SMM, jadi
     hasil harvest adalah kata kunci yang tidak ada padanannya di situs ini
     ("smm panel surabaya" -> halaman mana?).
  2. `--push` menulis langsung ke queue.json. Di port ini satu-satunya pintu ke
     antrean adalah keywords.json yang disetujui manusia + seed-queue.mjs;
     harvest yang bisa menyuntik queue membuat generator punya dua sumber
     permintaan dan menghapus langkah persetujuan.
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/keyword-suggest.mjs'
src = open(P, encoding='utf-8').read()

EDITS = []


def e(old, new):
    EDITS.append((old, new))


# ---------- docstring: contoh & keluaran ----------
e(' * Persona (mis. "jasa smm adalah" → orang mau paham, bukan mau beli) bisa',
  ' * persona (mis. "apa itu NUP" → orang mau paham, belum tentu mau beli) bisa')

e(" *   L2  abjad + terminator → \"smm a\"..\"smm z\", plus \"smm jakarta\", \"smm murah\"",
  ' *   L2  abjad + terminator → seed + " a".."z", plus " … murah", " … di cimahi"')

e(' *   `seo/keywords.suggested.json` — semua kandidat + skor, TIDAK langsung masuk\n'
  ' *   queue. Pemisahan ini penting: harvest itu murah tapi sekali tulis ke\n'
  ' *   `queue.json` tidak bisa dibatalkan, jadi harus bisa direview dulu\n'
  ' *   (`--push` baru menyalinnya sebagai `status: "pending"`).',
  ' *   `seo/keywords.suggested.json` — semua kandidat + skor, TIDAK langsung masuk\n'
  ' *   antrean generate. Harvest itu murah; sekali item masuk `queue.json` jejaknya\n'
  ' *   susah dibatalkan. Karena itu `--push` menyalin kandidat ke `keywords.json`\n'
  ' *   dengan `approved: false` — manusia yang tetap satu-satunya yang bisa\n'
  ' *   membukakan pintu ke antrean (lewat seed-queue.mjs setelah persetujuan).')

e(' *   node seo/keyword-suggest.mjs --push --min-score=20   # + masukkan ke queue',
  ' *   node seo/keyword-suggest.mjs --push --min-score=20   # + usulkan ke keywords.json')

# ---------- impor: butuh KEYWORDS_PATH ----------
e("import { BLOG_DIR, QUEUE_PATH, ROOT } from './paths.mjs';",
  "import { BLOG_DIR, QUEUE_PATH, KEYWORDS_PATH, ROOT } from './paths.mjs';")

# ---------- SEEDS ----------
e("""// ── Seed: semuanya breath-nya yang memang dicari orang ───────────────────────
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
];""",
  """// ── Seed: frasa yang memang diketik calon pembeli rumah di area ini ─────────
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
];""")

# ---------- INTENT / GEO / JUNK / AGENCY ----------
e("const INTENT_HIGH = /(smm|panel|sosmed|promot|reseller|agen|followers|likes|views|subscriber)/i;",
  "// Intent beli di properti = orang menghitung uang atau mencari unitnya, bukan\n"
  "// yang sedang mencari tahu definisi.\n"
  "const INTENT_HIGH = /(kpr|cicil|angsur|dp\\b|booking fee|nup\\b|ppjb|bphtb|surat\\b|denah|tipe\\s?45|unit\\b|dijual|harga|mitra|agen properti)/i;")

e("const GEO = /\\b(jakarta|bekasi|bandung|surabaya|medan|denpasar|makassar|semarang|yogyakarta|yogyakarta|jogja|palembang|balikpapan|pekanbaru|banjarmasin|samarinda|manado|gorontalo|pontianak|jayapura|ambon|ternate|tangerang|depok|bogor|batam|cikarang|karanganyar|sidoarjo|malang|kediri|palangka|palembang|sukabumi|garut|cirebon|majalengka|sumedang|karawang|bekasi)\\b/i;",
  "// Area yang masuk akal untuk proyek ini: pasar kita komuter Bandung Barat +\n"
  "// kota asal pembeli yang memang mencari rumah di koridor ini.\n"
  "const GEO = /\\b(cimahi|padalarang|bandung\\s?barat|bandung|laksanamekar|baros|ngamprah|batujajar|cililin|soreang|cikalong\\s?wetan|jawa\\s?barat|jakarta|depok|bekasi|tangerang|bogor)\\b/i;")

e("const JUNK = /\\b(smmt|adhoc|admin|login|akun gratis|topup|script|template|apk|bot|checker)\\b/i;",
  "// Sampah yang bukan maksud beli rumah sama sekali.\n"
  "const JUNK = /\\b(login|apk|template|wallpaper|job ?lowongan|loker|sewa\\b|kontrakan\\b|pindah\\b|film|drakor|game|slot|judi)\\b/i;")

e('/** Jasa agensi/social-media-management — BUKAN yang kita jual (katalog = panel). */\n'
  'const AGENCY = /\\b(kelola|manajemen|manajemen media|agen sosial|agensi|content creation|buat konten|admin medsos)\\b/i;',
  '/** Sewa/kontrak, bukan beli — tidak ada halaman tujuannya di situs ini. */\n'
  'const AGENCY = /\\b(sewa|kontrakan|ngontrak|kos|indekos|pulang\\s?kampung|renovasi\\s?murah)\\b/i;')

e('/** Suffix angka meaningless dari suggestion ("smm panel 1"). */',
  '/** Suffix angka tanpa makna dari suggestion ("rumah di cimahi 1"). */')

# ---------- --push: tulis kandidat ke keywords.json, bukan queue ----------
e("""  let maxPrio = Math.max(0, ...(queue.items || []).map((i) => i.priority || 0));
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
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\\n');
  console.log(`\\n[suggest] ${added} keyword masuk queue sebagai 'pending'.`);
  console.log('[suggest] generate sekarang:');
  console.log('[suggest] setelah daftar disetujui di keywords.json: node seo/seed-queue.mjs');
}""",
  """  // Pintu tunggal: kandidat masuk keywords.json sebagai approved:false dan
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
    writeFileSync(KEYWORDS_PATH, JSON.stringify(kwDoc, null, 2) + '\\n');
  }
  console.log(`\\n[suggest] ${added} kandidat masuk keywords.json dengan approved:false.`);
  console.log('[suggest] belum ada artikel yang dibuat. Alur sebenarnya:');
  console.log('[suggest]   1) review seo/keywords.json, set approved:true + _meta.approved_at');
  console.log('[suggest]   2) node seo/seed-queue.mjs   # baru masuk antrean generate');
}""")

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:70]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(src)
print(f'ok: {len(EDITS)} edit keyword-suggest.mjs')
