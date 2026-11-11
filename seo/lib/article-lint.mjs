#!/usr/bin/env node
/**
 * seo/lib/article-lint.mjs — SATU-SATUNYA sumber kebenaran validasi artikel.
 *
 * Kenapa modul ini ada (bug 4 Okt 2026):
 * `check-article.mjs` punya semua cek glitch, tapi cuma bisa dijalankan manual
 * (`pnpm seo:check-article <slug>`) dan TIDAK PERNAH dipanggil dari pipeline.
 * `generate.mjs` hanya memanggil `validateMdx` yang mengecek frontmatter saja
 * (title ≤70, description ≤160, faq = 5) — nol pemeriksaan teks korup. Akibatnya
 * artikel noise e.g. `yang_filters`, `sebelum ellos. hasten.` masuk korpus tanpa
 * pernah ditahan.
 *
 * Solusi: logika dipindah ke sini, lalu `check-article.mjs` jadi CLI tipis dan
 * `generate.mjs` memanggil `lintArticle()` yang sama. Satu implementasi, dua pintu.
 *
 * Yang DICECK (semua diuji lewat injeksi sintetis, lihat `node seo/lib/article-lint.mjs --self-test`):
 *   1. pagar frontmatter tepat 2
 *   2. karakter non-Latin (CJK / Hangul / Cyrillic / fullwidth / emoji astral)
 *   3. kata menempel glued camelCase (`hanyaIncrement`)
 *   4. junk markup Liquid/Jekyll (`yang_filters`, `&[i]`, `][i]`)
 *   5. sisa teks Inggris (`sebelum ellos. hasten.`, `Pertanyaan about harga`)
 *   6. frontmatter: YAML parse bener, title ≤70, description ≤160, faq tepat 5
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// js-yaml hanya terpasang di workspace `landing`, jadi resolve dari sana.
// Dipakai karena parsing manual pakai regex BUTA: frontmatter `a: "…\"…` tanpa
// penutup quote lolos regex, padahal YAML-nya rusak. Draft tidak pernah dirender
// Astro, jadi build TIDAK bisa menangkap ini — hanya parser YAML yang bisa.
const requireLanding = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'landing', 'noop.js'),
);
let YAML = null;
try {
  YAML = requireLanding('js-yaml');
} catch {
  // caller boleh lanjut; pemanggil yang memutuskan apakah ini fatal
}

export const yamlTersedia = () => YAML !== null;

// 1. Kata yang menempel: huruf kecil glued ke sufiks kapital.
// Versi lama butuh KAPITAL 3+ (`beliInstagram`) dan itu terlalu longgar —
// glitch nyata di korpus cuma 1-2 kapital: `hanyaIncrement`, `butuhPaparan`,
// `duanyaDescending`, `llNemu`, `mudahletyFriendpeople`. Sekarang 1 kapital cukup.
const KATA_CAMPUR = /\b[a-z]{3,}[A-Z][a-z]{2,}\b/g;
const KATA_CAMPUR_LEGIT = new Set(['date']);

// 2. Non-Latin. Range lama (CJK + Cyrillic + Latin-Extended) MISSED Hangul,
// fullwidth, dan emoji/simbol astral — ketiganya nyata muncul sebagai glitch
// 2 Okt 2026 dan lolos. Sekarang semuanya ditutup.
// SENGAJA tidak dimasukkan: tanda baca Latin sah (— · → ≥ ≤).
const ASING = /[\u0100-\u017f\u0370-\u03ff\u0400-\u04ff\u0530-\u058f\u0900-\u0dff\u0e00-\u0fff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const BOLEH = new Set([
  'instagram', 'tiktok', 'telegram', 'youtube', 'twitter', 'facebook', 'spotify', 'smm', 'faq',
]);

/**
 * 3. Sisa teks Inggris.
 *
 * Kenapa perlu: kelas ini yang paling lolos. `qc-uniqueness` hanya mengukur
 * kemiripan antar artikel, `check-article` (sebelum kelas ini ada) hanya
 * menangkap junk markup. Akibatnya kalimat seperti
 *   "sebelum ellos. hasten."  ·  "Pertanyaan about harga borongan"
 *   "tidak cheapest di daftar"
 * lolos semua gate.
 *
 * Kenapa BUKAN pakai kamus (`/usr/share/dict/words`): sudah dicoba 4 Okt dan
 * DIHAPUS — bising besar, menandai `angka`, `paling`, `batik`, `villa`, `sayur`.
 * Kamus bahasa Inggris tidak tahu mana yang pinjamAN sah di bahasa Indonesia.
 *
 * Pendekatan yang dipakai: daftar TERTUTUP kata berisiko tinggi, dikurangi frasa
 * pinjam yang sudah diverifikasi sah di korpus ini. Konservatif = lebih banyak
 * false negative (glitch lolos) daripada false positive (menolak tulisan baik).
 * Kalau ada kata yang terlewat, tambahkan ke `SISA_INGGRIS` — jangan longgarkan
 * jadi kamus.
 */
const SISA_INGGRIS = new Set([
  // Kata fungsi Inggris. Semua punya padanan Indonesia yang jelas, jadi kemunculannya
  // di prosa Indonesia hampir selalu berarti sisa templating/bahasa lain.
  // PENTING: kosakata domain situs ini (followers, likes, views, order, link,
  // account, service, dashboard, price, ...) SENGAJA TIDAK ADA di sini. Itu
  // vocabulary sah "Beli Followers Instagram", bukan kebocoran. 4 Okt: versi
  // pertama salah memasukkan semuanya dan menolak 61 dari 61 artikel.
  'the', 'and', 'with', 'without', 'from', 'your', 'you', 'our', 'their', 'its',
  'will', 'would', 'should', 'could', 'must', 'shall', 'can', 'may',
  'have', 'has', 'had', 'been', 'being', 'are', 'were',
  'this', 'that', 'these', 'those', 'there', 'here',
  'when', 'where', 'which', 'what', 'why', 'how', 'who', 'whom', 'whose',
  'into', 'onto', 'upon', 'within', 'among', 'against', 'toward', 'towards',
  'though', 'although', 'because', 'about', 'above', 'below', 'over', 'under',
  'again', 'further', 'then', 'than', 'such', 'only', 'just', 'also', 'very',
  'much', 'many', 'each', 'every', 'both', 'either', 'neither', 'while', 'until',
  'before', 'after', 'between', 'during', 'through', 'without', 'being',

  // Morfologi Inggris yang tidak ada padanannya di Indonesia. Ini yang benar-benar
  // bocor 4 Okt: `sebelum ellos. hasten.` dan `tidak cheapest di daftar`.
  'hasten', 'cheapest', 'cheaper', 'dearest', 'fastest', 'slowest', 'best',
  'worst', 'largest', 'smallest', 'highest', 'lowest', 'nearest', 'greatest',
]);

/**
 * Frasa pinjam yang SAH — dihapus dari teks SEBELUM sisa bahasa Inggris dicari.
 * Semuanya diverifikasi manual di korpus 61 artikel (4 Okt 2026).
 * Tambah di sini hanya kalau benar-benar lazim di bahasa Indonesia.
 */
const PINJAM_SAH = [
  /\binstagram for business\b/gi,
  /\bfor\s+(?:business|business\s+account)\b/gi,
  /\bbefore[-\s]?after\b/gi,
  /\bto the point\b/gi,
  /\bpay[-\s]as[-\s]you[-\s]go\b/gi,
  /\bfast respon\b/gi,
  /\bcheck\s?out\b/gi,
  /\bfollow\s?back\b/gi,
  /\bno\s?w\b/gi,
  /\bstart[-\s]up\b/gi,
  /\bfeedback\b/gi,
  /\badmin\s?panel\b/gi,
  /\buser\s?guide\b/gi,
  /\bscreenshot\b/gi,
  /\bchat\s?bot\b/gi,
];

/**
 * @param {string} src isi file .md lengkap
 * @returns {{err: string[], info: object}}
 */
export function lintArticle(src) {
  const err = [];
  const info = {};

  if (typeof src !== 'string' || !src.length) {
    return { err: ['file kosong'], info };
  }

  // ── 1. pagar frontmatter ────────────────────────────────────────────────
  const fences = (src.match(/^---$/gm) || []).length;
  if (fences !== 2) err.push(`pagar '---' = ${fences} (harus 2)`);
  if (!src.startsWith('---\n')) {
    err.push('baris pertama bukan pagar pembuka');
    return { err, info };
  }

  // ── 2. karakter non-Latin ───────────────────────────────────────────────
  if (ASING.test(src)) {
    const contoh = [...new Set([...src.matchAll(/[\u0100-\u017f\u0370-\u03ff\u0400-\u04ff\u0530-\u058f\u0900-\u0dff\u0e00-\u0fff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/gu)].map((m) => m[0]))];
    err.push(`ada karakter non-Latin: ${contoh.slice(0, 5).join(' ')}`);
  }

  // ── 3. kata menempel ───────────────────────────────────────────────────
  const mixed = [
    ...new Set([...src.matchAll(KATA_CAMPUR)].map((m) => m[0])),
  ].filter((w) => !BOLEH.has(w.toLowerCase()) && !KATA_CAMPUR_LEGIT.has(w));
  if (mixed.length) err.push(`kata campuran huruf: ${mixed.join(', ')}`);

  // ── 4. junk markup Liquid/Jekyll ────────────────────────────────────────
  const junk = [
    ...new Set([
      ...[...src.matchAll(/\b[a-z]+_[a-z]+\b/g)].map((m) => m[0]),
      ...[...src.matchAll(/&\[[a-z]{1,4}\]|\]\[[a-z]{1,4}\]/gi)].map((m) => m[0]),
      // sisa templating Liquid/Jekyll yang belum ter-substitusi
      ...[...src.matchAll(/\{\{[^}]{0,40}\}\}/g)].map((m) => m[0]),
    ]),
  ];
  if (junk.length) err.push(`junk markup: ${junk.join(', ')}`);

  // ── 5. sisa teks Inggris ────────────────────────────────────────────────
  const bersih = PINJAM_SAH.reduce((t, re) => t.replace(re, ' '), src);
  const leak = [
    ...new Set(
      [...bersih.matchAll(/\b[a-z]{2,}\b/g)]
        .map((m) => m[0].toLowerCase())
        .filter((w) => SISA_INGGRIS.has(w)),
    ),
  ];
  if (leak.length) err.push(`sisa teks Inggris: ${leak.join(', ')}`);

  // ── 6. frontmatter ──────────────────────────────────────────────────────
  const fmRaw = src.slice(4, src.indexOf('\n---', 3));
  let d = null;
  try {
    if (YAML) {
      let doc;
      try {
        doc = YAML.load(fmRaw);
      } catch (e) {
        err.push(`YAML frontmatter rusak: ${String(e.message).split('\n')[0]}`);
      }
      if (doc && typeof doc === 'object') {
        const faq = Array.isArray(doc.faq) ? doc.faq : [];
        d = {
          title: doc.title ?? null,
          description: doc.description ?? null,
          faq: faq.length,
          a: faq.filter((f) => f && typeof f.a === 'string' && f.a.trim()).length,
          draft: doc.draft ?? null,
        };
        for (const [i, f] of faq.entries()) {
          if (!f || typeof f.q !== 'string' || !f.q.trim()) err.push(`faq #${i + 1} tidak punya q`);
        }
      }
    }
    // fallback regex kalau js-yaml tidak tersedia
    const get = (k) => {
      const m = fmRaw.match(new RegExp(`^${k}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
      return m ? m[1] : null;
    };
    if (!d) {
      const faqBlock = fmRaw.slice(fmRaw.indexOf('faq:') + 4);
      const faqs = [...faqBlock.matchAll(/^\s*-\s*q:\s*"([^"]*)"\s*$/gm)];
      const as = [...faqBlock.matchAll(/^\s*a:\s*"([^"]*)"\s*$/gm)];
      d = { title: get('title'), description: get('description'), faq: faqs.length, a: as.length, draft: get('draft') };
    }

    if (!d.title) err.push('title tidak terbaca');
    else if (d.title.length > 70) err.push(`title ${d.title.length} karakter (maks 70)`);
    if (!d.description) err.push('description tidak terbaca');
    else if (d.description.length > 160) err.push(`description ${d.description.length} karakter (maks 160)`);
    if (d.faq !== 5) err.push(`faq ${d.faq} item (harus tepat 5)`);
    if (d.a !== 5) err.push(`faq punya ${d.a} field 'a' (harus 5)`);
    if (fmRaw.includes('- q::') || fmRaw.includes('::')) err.push('ada key YAML ganda (::)');
  } catch (e) {
    err.push(`frontmatter gagal dibaca: ${e.message}`);
  }

  info.draft = d?.draft ?? null;
  info.faq = d?.faq ?? 0;
  info.token = src.split('---', 2)[1]?.split(/\s+/).filter(Boolean).length ?? 0;
  return { err, info };
}

// ── self-test: injeksi 7 glitch yang PERNAH nyata di korpus ───────────────
if (process.argv.includes('--self-test')) {
  const FM = [
    '---',
    'title: Uji gate artikel',
    'description: Menasegarkan bahwa gate menangkap kelas glitch yang nyata muncul.',
    'faq:',
    '  - q: Pertanyaan uji?',
    '    a: Jawaban uji.',
    '  - q: Pertanyaan uji dua?',
    '    a: Jawaban uji dua.',
    '  - q: Pertanyaan uji tiga?',
    '    a: Jawaban uji tiga.',
    '  - q: Pertanyaan uji empat?',
    '    a: Jawaban uji empat.',
    '  - q: Pertanyaan uji lima?',
    '    a: Jawaban uji lima.',
    '---',
  ].join('\n');

  const KASUS = [
    ['liquid sisa', 'Satu pelanggan yang_filters lewat rekomendasi bernilai.', 'junk markup'],
    ['liquidAW', 'daripada_posts broadcast lebih murah.', 'junk markup'],
    ['liquidBF', 'karena_pattern yang tidak berubah.', 'junk markup'],
    ['inggris/1', 'apakah Anda benar-benar ada sebelum ellos. hasten.', 'sisa teks Inggris'],
    ['inggris/2', 'Pertanyaan about harga borongan, minimal order.', 'sisa teks Inggris'],
    ['inggris/3', 'FacebookReplay sengaja tidak cheapest di daftar.', 'sisa teks Inggris'],
    ['glued', 'butuhPaparan dan hanyaIncrement adalah dua hal.', 'kata campuran huruf'],
    ['cjk', 'harga \u8986\u76d6 semua pasar Asia.', 'karakter non-Latin'],
    ['hangul', '\uac00\uc7a5 murah di sini.', 'karakter non-Latin'],
    ['yaml rusak', null, 'YAML frontmatter rusak'],
    ['faq kurang', null, 'harus tepat 5'],
  ];

  let lulus = 0;
  let gagal = 0;
  for (const [nama, kalimat, harap] of KASUS) {
    let src = FM + '\n\nParagraf penguji.\n';
    if (nama === 'yaml rusak') {
      src = src.replace('description: Menasegarkan', 'description: "Menasegarkan');
    } else if (nama === 'faq kurang') {
      src = src.replace(/  - q: Pertanyaan uji tiga[\s\S]*?Jawaban uji tiga\.\n/, '');
    } else {
      src = src.replace('Paragraf penguji.', kalimat);
    }
    const { err } = lintArticle(src);
    const kena = err.some((e) => e.includes(harap));
    if (kena) {
      lulus++;
      console.log(`  ✓ ${nama.padEnd(12)} → ${err.find((e) => e.includes(harap))}`);
    } else {
      gagal++;
      console.log(`  ✗ ${nama.padEnd(12)} → TIDAK TERTANGKAP (harap: ${harap}) · err: ${JSON.stringify(err)}`);
    }
  }

  // kontrol negatif: tulisan yang SAH tidak boleh ditolak
  const SAH = FM + '\n\nInstagram for Business, posting before-after, to the point, fast respon, pay-as-you-go, dan harga jelas-even kalau mahalnya.\n';
  const { err: errSah } = lintArticle(SAH);
  const bocor = errSah.filter((e) => e.includes('sisa teks Inggris'));
  if (bocor.length) {
    gagal++;
    console.log(`  ✗ false positive  → pinjam sah ditolak: ${bocor[0]}`);
  } else {
    lulus++;
    console.log('  ✓ false positive → pinjam sah (for/before-after/the point/even) tidak ditolak');
  }

  console.log(`\n  self-test: ${lulus} lulus, ${gagal} gagal`);
  process.exitCode = gagal ? 1 : 0;
}
