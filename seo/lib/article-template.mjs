/**
 * seo/lib/article-template.mjs — blueprint bagian artikel (template-first).
 *
 * Prinsip: SKRIP memegang struktur, LLM hanya menulis prosa. Semua elemen yang
 * dulu diserahkan ke kepatuhan model (link internal, link keluar, judul H2,
 * tabel fakta, CTA, penutup) kini deterministik — hasilnya: panggilan LLM lebih
 * kecil, lebih sedikit, dan gate hampir tidak mungkin gagal karena link/judul.
 *
 * Blueprint satu artikel (~950 kata):
 *
 *   #  bagian            sumber   isi
 *   -- ----------------  -------  ----------------------------------------
 *   1  frontmatter       statik   title/slug/description/tags (deriveMeta)
 *   2  intro             LLM      1 paragraf ≤45 kata, keyword di kalimat 1
 *   3  H2-1 (t1)         LLM      2 paragraf; judul dari sectionTitles()
 *   4  tabel fakta       statik   renderFactTable() setelah H2-1 (assembleMdx)
 *   5  H2-2 (t2)         LLM      2 paragraf
 *   6  H2-3 (t3)         LLM      2 paragraf
 *   7  H2-4 (t4)         LLM      2 paragraf
 *   8  penutup           statik   pickClosing() — 1 paragraf, tanpa heading
 *   9  link keluar       statik   pickOutbound() — 1 sumber resmi, LLM tak mengarang URL
 *   10 FAQ               LLM      5 tanya-jawab (buildPartPrompt 'faq')
 *   11 CTA + Baca juga   statik   renderCtaBlock() + 2 link /blog/ (assembleMdx)
 *
 * Anggaran LLM per artikel: 3 panggilan kecil (partA ~350 tok, partB ~300,
 * faq ~350) + system pendek ~120 tok — total ~1.9k token output, tanpa retry
 * karena struktur tidak lagi diserahkan ke model.
 *
 * Judul H2 dan penutup diputar dari pool via hash(keyword) supaya artikel
 * serumpun tidak tampak kembar. Gate tetap di validateMdx + lintArticle.
 */

// System pendek untuk mode parts — aturan link/format tak diperlukan lagi
// karena skrip yang menyuntikkannya. Lebih pendek = lebih murah per panggilan.
export const PARTS_SYSTEM_PROMPT = `Kamu penulis konten Valley Cityview — perumahan tipe 45/72 di Laksanamekar, Padalarang (Cimahi), untuk calon pembeli rumah pertama berpenghasilan Rp 4-10 juta/bulan.

ATURAN KERAS:
1. Angka rupiah HANYA dari daftar angka rekaman yang diberikan di prompt. Mengarang angka lain = gugur.
2. Bahasa Indonesia natural, kalimat aktif, panjang kalimat bervariasi. Tanpa emoji, tanpa klise ("di era digital", "hunian impian").
3. Tulis HANYA bagian yang diminta. Dilarang menambah heading, link, daftar, penutup, atau bagian lain.
4. Setiap section punya minimal satu langkah konkret yang bisa dilakukan pembaca minggu ini.
5. Output: markdown prosa saja, paragraf dipisah baris kosong.`;

const ACRONYMS = new Set(['KPR', 'IMB', 'PBG', 'SHM', 'SHGB', 'BPHTB', 'DP', 'TMA', 'KCIC', 'OJK', 'BPS', 'PUPR', 'UMR', 'UMKM']);

function capitalize(s) {
  return String(s || '')
    .split(/\s+/)
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function hash(s) {
  return String(s || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
}

/**
 * Empat judul H2 dari pool yang diputar hash(keyword). H2-1 WAJIB memuat
 * keyword utuh (gate validateMdx mengecek dua kata pertama keyword di H2).
 * Keyword panjang (>48 karakter) jadi judul H2-1 apa adanya tanpa sambungan,
 * supaya judul tidak lepas kendali.
 */
const T1_TAILS = [
  'Hitungan yang Perlu Dihitung Dulu',
  'Yang Perlu Anda Hitung Sebelum Survei',
  'Sekilas Angka dan Kenyataannya',
  'Fakta Angka yang Jarang Diceritakan',
  'Titik Awal yang Jujur',
];
const T2_TITLES = [
  'Cara Mengecek Langkah demi Langkah',
  'Langkah Praktis yang Bisa Dimulai Minggu Ini',
  'Urutan Pengecekan dari yang Termurah',
  'Daftar Periksa Sebelum Melangkah',
  'Cara Kerjanya dan Urutan Pengecekannya',
];
const T3_TITLES = [
  'Biaya dan Risiko yang Sering Terlewat',
  'Jebakan Kecil yang Sering Muncul',
  'Yang Sering Salah Dibaca Pembeli',
  'Sisi yang Jarang Dibahas Brosur',
  'Risiko yang Perlu Diketahui Sejak Awal',
];
const T4_TITLES = [
  'Membandingkan dengan Pilihan Lain di Cimahi',
  'Cara Membandingkan Tanpa Tersesat Iklan',
  'Pembanding yang Wajar untuk Area Ini',
  'Cocok untuk Siapa dan Kapan',
  'Kapan Masuk Akal dan Kapan Sebaiknya Menunggu',
];

export function sectionTitles(keyword) {
  const h = hash(keyword);
  const kw = capitalize((keyword || '').trim());
  const t1 = kw.length <= 48 ? `${kw}: ${T1_TAILS[h % T1_TAILS.length]}` : kw;
  return [
    t1,
    T2_TITLES[(h >> 3) % T2_TITLES.length],
    T3_TITLES[(h >> 6) % T3_TITLES.length],
    T4_TITLES[(h >> 9) % T4_TITLES.length],
  ];
}

/**
 * Link keluar dari whitelist — LLM tidak pernah mengarang URL. Satu artikel =
 * satu sumber resmi (gate: 1-2 external). Domain root yang stabil, bukan deep
 * link yang bisa busuk. Urutan match: spesifik dulu, umum belakangan.
 */
const OUTBOUND_RULES = [
  {
    match: /whoosh|kcic|stasiun|kereta cepat/,
    html: (a) => `Cek jadwal dan tarif resmi kereta cepat di [${a}](https://kcic.co.id) sebelum jadwal survei lokasi.`,
    anchor: 'situs resmi Whoosh KCIC',
  },
  {
    match: /harga|biaya|bphtb|pajak|statistik/,
    html: (a) => `Data harga dan statistik wilayah bisa Anda telusuri sendiri di [${a}](https://www.bps.go.id).`,
    anchor: 'situs resmi BPS',
  },
  {
    match: /kpr|cicilan|kredit|dp|angsuran|bunga|simulasi|refinancing/,
    html: (a) => `Aturan main pembiayaan yang baik mengikuti [${a}](https://www.ojk.go.id) — layak dicermati sebelum mengajukan KPR.`,
    anchor: 'prinsip kredit sehat dari OJK',
  },
  {
    match: /legalitas|sertifikat|pbg|imb|ppjb|akta|shgb/,
    html: (a) => `Status perizinan bangunan mengikuti aturan [${a}](https://www.pupr.go.id) — tanyakan PBG unit yang Anda pilih, bukan cluster secara umum.`,
    anchor: 'layanan perizinan bangunan Kementerian PUPR',
  },
  {
    match: /cimahi/,
    html: (a) => `Info tata ruang dan pembangunan kota bisa dicek di [${a}](https://cimahikota.go.id).`,
    anchor: 'situs resmi Kota Cimahi',
  },
  {
    match: /padalarang|bandung barat/,
    html: (a) => `Info tata ruang dan pembangunan wilayah bisa dicek di [${a}](https://bandungbaratkab.go.id).`,
    anchor: 'situs resmi Kabupaten Bandung Barat',
  },
  {
    match: /lokasi|area|komuter|akses/,
    html: (a) => `Info tata ruang dan pembangunan wilayah bisa dicek di [${a}](https://bandungbaratkab.go.id).`,
    anchor: 'situs resmi Kabupaten Bandung Barat',
  },
];

export function pickOutbound({ keyword = '', category = '', city = '' } = {}) {
  const hay = `${keyword} ${category} ${city}`.toLowerCase();
  const rule = OUTBOUND_RULES.find((r) => r.match.test(hay)) || OUTBOUND_RULES[2];
  return { line: rule.html(rule.anchor), anchor: rule.anchor };
}

/**
 * Penutup statik — 1 paragraf tanpa heading (gate melarang heading
 * "Kesimpulan"). Diputar hash(keyword); memuat keyword utuh sekali supaya
 * density gate tetap aman walau prosa LLM singkat.
 */
const CLOSINGS = [
  (kw) => `Keputusan soal ${kw} paling aman diambil dengan angka sendiri: cek slip gaji, hitung rasio cicilan terhadap penghasilan, lalu tanyakan ketersediaan unit ke tim penjualan sebelum tanda tangan. Lima menit perhitungan hari ini jauh lebih murah daripada penyesalan dua puluh tahun.`,
  (kw) => `Kalau sudah sampai di sini, Anda punya bekal lebih lengkap dari kebanyakan pembeli ${kw}: angka yang bisa diperiksa, biaya yang perlu ditanyakan, dan risiko yang bisa diantisipasi. Langkah berikutnya sederhana — survei lokasi pada jam Anda biasanya berangkat kerja, lalu bandingkan hasilnya dengan hitungan di halaman simulasi.`,
  (kw) => `Pada akhirnya ${kw} adalah keputusan keuangan dua puluh tahun, bukan sekadar pilihan rumah. Bawa daftar pertanyaan di atas saat bertemu marketing, minta jawaban tertulis, dan beri waktu satu-dua hari sebelum tanda tangan. Rumah yang baik akan tetap ada besok; keputusan tergesa yang tidak.`,
  (kw) => `Satu penutup yang praktis: jangan jatuh cinta pada gambar promo. Cocokkan ${kw} dengan angka penghasilan Anda sendiri, tanyakan yang tidak tertulis di brosur, dan buat surat pesanan hanya setelah semua biaya terbaca. Kebanyakan pembeli di Laksanamekar begitu — dan itu bukan kebetulan.`,
];

export function pickClosing(keyword) {
  return CLOSINGS[hash(keyword + '|closing') % CLOSINGS.length](capitalize(keyword));
}

function geoBlockFor({ localAnchor, localBuyer }) {
  return localAnchor
    ? `\nKONTEKS LOKAL (sebut secara natural di salah satu bagian; angka di konteks ini sudah ditulis dengan kata — pertahankan bentuk kata, jangan mengganti dengan simbol Rp; simbol Rp hanya boleh dari bagian [harga]):\n- Karakter area: ${spellRpFigures(localAnchor)}\n- Pembeli yang paling mungkin: ${spellRpFigures(localBuyer)}`
    : '';
}

/**
 * Ubah angka rupiah berformat simbol ("Rp 4-10 juta", "Rp 350 ribu") di data
 * queue menjadi kata ("empat sampai sepuluh juta"). Dua alasan:
 *   1. Gate validateMdx menolak angka Rp apa pun di luar angka rekaman —
 *      konteks pembeli ber-angka akan hard-fail selamanya bila diteruskan
 *      mentah ke model (yang menyalinnya ke prosa).
 *   2. Model bebas memparafrase tanpa tergoda menyalin pola "Rp 4".
 * Nilai non-Rp (±4 km, 20 tahun) tidak disentuh.
 */
const ONES = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function toWords(n) {
  n = Math.round(n);
  if (n < 12) return ONES[n];
  if (n < 20) return `${ONES[n - 10]} belas`;
  if (n < 100) return `${ONES[Math.floor(n / 10)]} puluh${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
  if (n < 200) return `seratus${n % 100 ? ` ${toWords(n % 100)}` : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} ratus${n % 100 ? ` ${toWords(n % 100)}` : ''}`;
  return String(n);
}
export function spellRpFigures(s) {
  return String(s).replace(
    /Rp\.?\s?(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)(?:\s?(?:-|–|—|sd|sampai|hingga)\s?(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?))?\s?(ribu|juta|miliar)?/gi,
    (m, a, b, unit) => {
      // Angka berpemisah titik = harga rekaman (Rp 599.000.000) — JANGAN disentuh.
      if (a.includes('.') || (b && b.includes('.'))) return m;
      const say = (x) => {
        const parts = String(x).replace(',', '.').split('.');
        const dec = parts[1] ? ` koma ${parts[1].split('').map((d) => toWords(Number(d))).join(' ')}` : '';
        const w = `${toWords(Number(parts[0]))}${dec}`;
        return unit ? `${w} ${unit.toLowerCase()}` : `${w} rupiah`;
      };
      return b ? `${say(a)} sampai ${say(b)}` : say(a);
    },
  );
}

/**
 * Panggilan 1: pembuka + H2-1 + H2-2. Model menulis heading persis seperti
 * diberikan, lalu splitIntroSections() menormalkannya — teks heading apapun
 * yang ditulis model akan diganti judul template saat dirakit.
 */
export function buildPartA({ keyword, category, intent, pricesBlock, localAnchor, localBuyer, titles }) {
  const kw = capitalize(keyword || '');
  return `Keyword fokus: "${keyword}"
Topik: ${category}${intent ? `\nYang dicari pembaca: ${intent}` : ''}${geoBlockFor({ localAnchor, localBuyer })}

Tulis BAGIAN AWAL artikel:
1. Satu paragraf pembuka MAKSIMAL 45 kata; kalimat pertamanya memuat frasa "${keyword}" utuh.
2. Baris heading persis: "## ${titles[0]}" lalu isi 2 paragraf (3-4 kalimat per paragraf).
3. Baris heading persis: "## ${titles[1]}" lalu isi 2 paragraf.

Aturan:
- TOTAL seluruh bagian ini maksimal 340 kata (paragraf 3-4 kalimat YANG PENDEK, tiap kalimat < 20 kata).
- Angka rupiah HANYA dari daftar ini: ${pricesBlock}
- Frasa "${keyword}" total maksimal 3x di seluruh bagian Anda; sisanya pakai sinonim (unit, rumah, hunian).
- Tanpa link, tanpa emoji, tanpa bagian lain, tanpa penutup.`;
}

/**
 * Panggilan 2: H2-3 + H2-4. Tanpa pembuka, tanpa penutup — keduanya statik.
 */
export function buildPartB({ keyword, category, intent, pricesBlock, localAnchor, localBuyer, titles }) {
  return `Keyword fokus: "${keyword}"
Topik: ${category}${intent ? `\nYang dicari pembaca: ${intent}` : ''}${geoBlockFor({ localAnchor, localBuyer })}

Lanjutan artikel (BAGIAN AKHIR):
1. Baris heading persis: "## ${titles[2]}" lalu isi 2 paragraf (3-4 kalimat per paragraf).
2. Baris heading persis: "## ${titles[3]}" lalu isi 2 paragraf.

Aturan:
- TOTAL seluruh bagian ini maksimal 320 kata (paragraf 3-4 kalimat YANG PENDEK, tiap kalimat < 20 kata).
- Angka rupiah HANYA dari daftar ini: ${pricesBlock}
- Sebut "${keyword}" minimal 1x secara natural; sisanya sinonim.
- Tanpa link, tanpa emoji, tanpa pembuka, tanpa penutup, tanpa bagian lain.`;
}

// ── normalizer output panggilan ──────────────────────────────────────────────
// Model kadang menulis heading dengan kata sendiri — tak masalah: skrip memotong
// per "## " dan MENGGANTI judul dengan versi template. Bagian ekstra dipangkas,
// bagian kurang = gagal (retry provider berikut, bukan dipad).

function toChunks(raw) {
  return String(raw || '')
    .replace(/^```(?:markdown|md)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .replace(/^---\s*$/gm, '')
    .split(/\n(?=##\s)/)
    .map((c) => c.replace(/^#{1,6}\s.*\n?/, '').trim()) // buang baris heading milik model
    .filter(Boolean);
}

/**
 * partA → { intro, sections: [proseH2a, proseH2b] }
 * Chunk pertama (tanpa heading) = pembuka. Butuh minimal 2 section berheading.
 */
export function splitIntroSections(raw) {
  const chunks = toChunks(raw);
  if (chunks.length < 3) return null;
  const [intro, ...rest] = chunks;
  if (intro.split(/\s+/).length < 15) return null; // pembuka terlalu pendek
  const sections = rest.slice(0, 2);
  if (sections.some((s) => s.split(/\s+/).length < 60)) return null; // isi section terlalu tipis
  return { intro, sections };
}

/**
 * partB → sections: [proseH2c, proseH2d]. Tidak ada pembuka; preamble pendek
 * yang menyusup digabung ke section pertama supaya tidak ada teks hilang.
 */
export function splitBodySections(raw) {
  const chunks = toChunks(raw);
  const headless = chunks.length && !/^##\s/.test(String(raw).trim()) ? chunks[0] : '';
  const headed = headless ? chunks.slice(1) : chunks;
  if (headed.length < 2) return null;
  let first = headed[0];
  if (headless && headless.split(/\s+/).length >= 15) first = `${headless}\n\n${first}`;
  const sections = [first, headed[1]].concat(headed.slice(2, 3)); // ekstra (mis. penutup) dibuang
  if (sections.some((s) => s.split(/\s+/).length < 60)) return null;
  return { sections: sections.slice(0, 2) };
}

/**
 * Parser output panggilan FAQ — empat bentuk dicoba berurutan. Model murah
 * sering menulis artikel dulu lalu menaruh Q+A di akhir, atau tidak bernomor
 * sama sekali; semua heading dibuang dulu supaya tidak merusak ekstraksi.
 * (Dipindah utuh dari generate.mjs — satu implementasi, bukan salinan.)
 */
export function parseFaqPart(raw) {
  const txt = String(raw || '').replace(/^\s*#{1,6}\s.*$/gm, '');
  const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  // (1) bernomor: "1. pertanyaan?" + "Jawaban: ..."
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
  // (2) bold question "**...?**" + paragraf; (3) "Q: ... / A: ..."
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
}
