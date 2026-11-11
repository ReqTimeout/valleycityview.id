/**
 * seo/prompts.ts — kontrak editorial mesin artikel Valley Cityview.
 *
 * Di-port dari ssoe-runner/seo/prompts.ts dengan permukaan export yang sama
 * (SYSTEM_PROMPT, buildUserPrompt, buildPartPrompt, parseOutput, assembleMdx,
 * validateMdx, deriveMeta) supaya generate.mjs tidak perlu diubah bentuknya —
 * yang diganti SUARA dan FAKTA, bukan mesinnya.
 *
 * Beda mendasar dengan socio.id:
 *   - Satu produk (tipe 45/72 di Padalarang), bukan katalog 8.000 layanan.
 *     Tidak ada "tabel harga per 1.000"; yang ada angka rekaman: harga KPR
 *     Rp 599 juta, cicilan Rp 3.871.000/bulan, booking Rp 5 juta.
 *   - Konten ditulis untuk pembeli rumah, bukan reseller SMM. Yang dicari
 *     pembaca: apakah angka ini masuk akal untuk gajinya, dan apa risikonya.
 *   - Frontmatter mengikuti schema koleksi (site/src/content.config.ts):
 *     status: draft|review|publish, date, tags — BUKAN draft: true + category.
 *   - Badan artikel Markdown polos. Site ini me-render Markdown + HTML mentah
 *     (rehypeRaw), jadi tidak perlu komponen MDX.
 *
 * Token budget: system ~350, user ~250, output ~1800.
 */

export const SYSTEM_PROMPT = `Kamu editor konten Valley Cityview — perumahan tipe 45/72 m² di Laksanamekar, Padalarang, Cimahi. Tulis Bahasa Indonesia yang natural, kalimat aktif, angka konkret, tanpa basa-basi properti.

KAMU MENULIS UNTUK: orang dengan penghasilan Rp 4–10 juta/bulan yang mempertimbangkan rumah pertama di sisi barat Bandung (Padalarang, Cimahi, Bandung Barat) dan curiga pada iklan "cicilan 1 jutaan".

ATURAN FAKTA (keras, tidak boleh dilanggar):
1. Satu-satunya angka rupiah yang boleh kamu tulis adalah angka rekaman di bawah. Mengarang angka lain = artikel ditolak gate.
   - Harga KPR: Rp 599.000.000
   - Cicilan: Rp 3.871.000 per bulan (tenor 20 tahun)
   - Booking fee: Rp 5.000.000 (bisa dicicil)
   - Luas: bangunan 45 m² / lahan 72 m², 2 kamar tidur, 1 kamar mandi
   - Jarak: 15 menit ke Stasiun KCIC Padalarang, 10 menit ke kampus Unjani Cimahi
2. Harga properti lain (Summarecon, Podomoro, dsb.) JANGAN pernah disebut sebagai angka pasti. Boleh disebut sebagai pembanding kualitatif ("jauh di atas kelas ini") tanpa angka.
3. Jangan menjanjikan legalitas/sertifikat tertentu kalau tidak diminta di data; cukup rujuk ke tim penjualan.
4. Jangan menulis "harga sewaktu-waktu berubah" lebih dari sekali.

FORMAT OUTPUT (cek sebelum submit):
- 1 paragraf pembuka yang langsung menjawab topik, maksimal 40 kata, mengandung keyword fokus.
- TEPAT 4 section "## Judul" dengan 3-5 paragraf isi. H2 pertama memuat keyword fokus.
- TEPAT 3 link internal: 1 ke halaman simulasi KPR (/simulasi-kpr/), 2 ke slug artikel terkait yang diberikan.
- TEPAT 1 link eksternal ke sumber resmi Indonesia (bps.go.id, ojk.go.id, pupr.go.id, bi.go.id, atau situs pemerintah kota) yang benar-benar mendukung klaim di paragraf itu.
- Ditutup 1-2 paragraf TANPA heading. Dilarang memakai heading "Kesimpulan"/"Penutup"/"Ringkasan".
- Output body saja: tanpa frontmatter "---", tanpa "# H1", tanpa emoji.

GAYA:
- Variasikan panjang kalimat. Sesekali bicara langsung ke pembaca ("coba hitung sendiri").
- Setiap section punya minimal satu contoh konkret yang bisa dikerjakan pembaca minggu ini (telepon developer, cek slip gaji, hitung rasio cicilan terhadap penghasilan, survei lokasi saat jam berangkat kerja).
- Dilarang klise: "di era digital", "seiring berkembangnya teknologi", "investasi masa depan", "hunian impian" tanpa isi.
- Tulis dari sudut pandang pembeli. Jangan menyebut nama tabel, slug, kolom database, atau istilah internal sistem.
- Keyword fokus disebut 6-12 kali natural, plus 2-4 sinonim (unit, rumah, hunian, KPR).

RAMAH SITASI AI: kalimat yang mengandung angka atau fakta harus berdiri sendiri supaya bisa dikutip, misalnya "Dengan harga Rp 599.000.000 dan tenor 20 tahun, cicilan Valley Cityview Rp 3.871.000 per bulan."`;

/**
 * Prompt user — keyword + kerangka + data yang boleh dipakai.
 * `localAnchor`/`localBuyer` opsional: konteks area (Padalarang/Cimahi).
 */
export function buildUserPrompt({ keyword, category, related, pricesBlock, localAnchor, localBuyer }) {
  const geoBlock = localAnchor
    ? `
KONTEKS LOKAL (pakai, ini yang membedakan halaman ini dari doorway page):
- Karakter area: ${localAnchor}
- Pembeli yang paling mungkin: ${localBuyer}
Sebut konteks ini di paragraf pertama dan di satu section H2. Jangan mengarang fakta daerah lain.`
    : '';

  return `Keyword fokus: "${keyword}"
Topik: ${category}
${geoBlock}
Artikel terkait (pilih 2, taruh link-nya di body):
${related.map((r) => `- ${r.slug}`).join('\n')}

Angka rekaman yang boleh dipakai:
${pricesBlock}

TULIS SEKARANG. Mulai dari paragraf definisi (maks 40 kata, memuat keyword), lalu TEPAT 4 section H2, tutup tanpa heading. Cek mental sebelum submit: [1] tidak ada angka rupiah di luar angka rekaman [2] keyword muncul minimal 6x [3] H2 pertama memuat keyword [4] TEPAT 1 link eksternal ke sumber resmi [5] TEPAT 3 link internal termasuk /simulasi-kpr/ [6] tidak ada heading Kesimpulan. Output body markdown saja.`;
}

/**
 * Mode --split: satu bagian per panggilan.
 *
 * Dipecah karena model gratis tidak sanggup satu tugas 900 kata: di proyek sebelumnya
 * empat artikel paralel menghasilkan ~400 kata dan 0/4 lolos gate. Untuk
 * Valley Cityview target body lebih pendek (700-1000 kata), tapi pola
 * kegagalannya sama, jadi pertahankan tiga panggilan: intro+H2 1-2,
 * H2 3-4, lalu FAQ.
 *
 * `part`: 'intro+1+2' | '3+4' | 'faq'
 */
export function buildPartPrompt(part, ctx) {
  const { keyword, category, related, pricesBlock, localAnchor, localBuyer, sectionTitles } = ctx;
  const geoBlock = localAnchor
    ? `
KONTEKS LOKAL (wajib dipakai):
- Karakter area: ${localAnchor}
- Pembeli yang paling mungkin: ${localBuyer}`
    : '';

  if (part === 'faq') {
    return `Tulis 5 pasang tanya-jawab bahasa Indonesia untuk artikel keyword "${keyword}".
${geoBlock}

Aturan:
- TEPAT 5, bernomor 1-5. Format persis: baris "1. <pertanyaan>", baris berikutnya "Jawaban: <jawaban>".
- Pertanyaan maksimal 12 kata, seperti yang benar-benar ditanyakan pembeli ke marketing.
- Jawaban 3-4 kalimat, spesifik. Boleh sebut angka rekaman: harga Rp 599.000.000, cicilan Rp 3.871.000/bulan, booking Rp 5.000.000, tipe 45/72, tenor 20 tahun.
- Jangan mengarang angka rupiah lain. Jangan emoji. Jangan link.`;
  }

  const isFirst = part === 'intro+1+2';
  const titles = sectionTitles || [];
  const t1 = titles[0] || `Kenapa ${keyword} perlu dihitung sebelum survei`;
  const t2 = titles[1] || `Cara kerja dan angka yang perlu Anda tanyakan`;
  const t3 = titles[2] || `Biaya tersembunyi dan risiko yang sering terlewat`;
  const t4 = titles[3] || `Membandingkan ${keyword} dengan pilihan lain di Cimahi`;

  const head = isFirst
    ? `Tulis BAGIAN AWAL artikel (1 dari 2) untuk keyword: "${keyword}"
Topik: ${category}
${geoBlock}

WAJIB berisi:
1. Paragraf pembuka definisi (maks 40 kata) yang memuat keyword dan menjawab langsung.
2. Section H2 berjudul: "${t1}" — 3-5 paragraf.
3. Section H2 berjudul: "${t2}" — 3-5 paragraf.`
    : `Tulis BAGIAN AKHIR artikel (2 dari 2) untuk keyword: "${keyword}"
Topik: ${category}
${geoBlock}

WAJIB berisi:
1. Section H2 berjudul: "${t3}" — 3-5 paragraf.
2. Section H2 berjudul: "${t4}" — 3-5 paragraf.
3. Ditutup 1-2 paragraf tanpa heading, tanpa kata "Kesimpulan".`;

  return `${head}

ATURAN KUAT:
- Total ${isFirst ? '360-450' : '340-430'} kata untuk bagian ini. Minimum 320 kata — model gratis cenderung terlalu pendek, jadi angka ini batas keras.
- 3-5 kalimat per paragraf, kalimat pendek dan panjang bergantian.
- Minimal satu hal konkret yang bisa dilakukan pembaca per section.
- ${isFirst ? `H2 pertama WAJIB memuat "${(keyword || '').split(' ').slice(0, 3).join(' ')}".` : 'Sebut keyword fokus minimal 3x secara natural.'}
- ${isFirst ? 'Sertakan TEPAT 1 link ke /simulasi-kpr/ dan 2 link ke slug artikel terkait berikut: ' + (related || []).map((r) => r.slug).join(', ') + '.' : 'Sertakan maksimal 1 link internal, jangan berlebihan.'}
- ${isFirst ? 'TEPAT 1 link eksternal ke sumber resmi (bps.go.id / ojk.go.id / pupr.go.id / bi.go.id / situs pemda).' : 'Jangan menambah link eksternal.'}
- Angka rupiah HANYA dari daftar ini: ${pricesBlock}. Mengarang angka lain = gugur.
- Tanpa emoji, tanpa harga "Rp" karangan, output hanya markdown bagian ini.`;
}

/** Ambil body dari respons LLM (buang pagar kode kalau model membungkusnya). */
export function parseOutput(content: string): string {
  let c = content.trim();
  c = c.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '');
  return c.trim();
}

/**
 * Rakit output LLM + template deterministik menjadi berkas Markdown final.
 * Nama fungsi dipertahankan (assembleMdx) karena generate.mjs memanggilnya
 * dengan nama itu; hasilnya kini berkas .md dengan frontmatter koleksi kami.
 */
export function assembleMdx({ llmBody, prices, moneyLink, related, faq, meta }: any): string {
  const bodyNoFaq = linkifyBareUrls(stripFabricatedRp(llmBody));
  const bodyWithFacts = injectAfterFirstH2(bodyNoFaq, renderFactTable(prices));
  const faqBlock = renderFaq(faq);
  const bodyWithCta = bodyWithFacts + '\n\n' + faqBlock + '\n\n' + renderCtaBlock();

  // Jaring pengaman: generator tidak boleh bergantung pada kepatuhan LLM
  // soal link money page — sisipkan sendiri kalau tidak ada.
  const hasMoneyLink = /\/simulasi-kpr\/|\/#unit|\/#booking|\/agent\//.test(bodyWithCta);
  const moneyLine = hasMoneyLink
    ? ''
    : `\n\nLihat juga: [${moneyLink.anchor}](${moneyLink.url}).`;

  const safeRel = (related || []).filter((r) => r.slug && r.slug !== meta.slug).slice(0, 2);
  const bacaJuga =
    safeRel.length >= 2
      ? '\n\n## Baca juga\n\n' +
        safeRel.map((r) => `- [${r.title || capitalize(r.slug)}](/blog/${r.slug}/)`).join('\n')
      : '';

  const bodyFinal = bodyWithCta + moneyLine + bacaJuga;

  const today = new Date().toISOString().slice(0, 10);
  const fm = renderFrontmatter({
    title: meta.title,
    slug: meta.slug,
    description: meta.description,
    date: meta.pubDate || today,
    tags: meta.tags || [meta.category],
    cover: meta.cover,
    status: 'draft',
  });
  return `${fm}\n\n${bodyFinal}\n`;
}

// ===== helper template (dipakai langsung via import, tidak lagi disalin ke generate.mjs) =====

function renderFrontmatter({ title, slug, description, date, tags, cover, status }: any): string {
  const tagYaml = (tags || []).filter(Boolean).map((t) => `"${escapeYaml(t)}"`).join(', ');
  return `---
title: "${escapeYaml(title)}"
slug: "${escapeYaml(slug)}"
description: "${escapeYaml(description)}"
date: "${date}"
author: "Tim Valley Cityview"
status: ${status}
tags: [${tagYaml}]${cover ? `\ncover: "${cover}"` : ''}
---`;
}

function escapeYaml(s: any): string {
  if (!s) return '';
  return String(s).replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 200);
}

/**
 * Tabel angka rekaman — disisipkan template, bukan dikarang LLM.
 */
function renderFactTable(prices: any): string {
  const rows = (prices || [])
    .slice(0, 4)
    .map(
      (p) =>
        `| ${escapeMd(p.platform)} | ${escapeMd(p.price)} | ${escapeMd(p.installment)} | ${escapeMd(p.note)} |`,
    )
    .join('\n');
  return `| Unit | Harga KPR | Cicilan | Keterangan |
| --- | --- | --- | --- |
${rows}

*Angka di atas adalah harga rekaman per tanggal penulisan. Untuk ketersediaan unit dan skema terbaru, hubungi tim penjualan.*`;
}

/**
 * Callout "periksa sebelum tanda tangan" — pengganti tips-aman socio.id.
 * Ini nilai tambah yang membuat halaman bukan sekadar brosur.
 */
function renderChecklistCallout(): string {
  return `> **Empat hal yang perlu Anda cek sebelum tanda tangan**: (1) Minta rincian bunga tetap dan bunga floating setelah masa promo — cicilan awal bukan cicilan selamanya. (2) Konfirmasi biaya provisi, administrasi, appraisal, dan asuransi dalam satu angka. (3) Tanyakan status legalitas tanah dan IMB/PBG unit yang Anda pilih, bukan status cluster secara umum. (4) Survei lokasi pada jam berangkat kerja Anda, bukan hanya saat akhir pekan.`;
}

function renderCtaBlock(): string {
  return `${renderChecklistCallout()}

> **Ingin tahu angkanya masuk untuk penghasilan Anda?** Hitung sendiri di [halaman simulasi KPR](/simulasi-kpr/) — isi penghasilan dan tenor, langsung terlihat cicilannya. Atau tanyakan ketersediaan unit lewat WhatsApp ke tim Valley Cityview.`;
}

function renderFaq(faq: any): string {
  const items = (faq || []).slice(0, 5);
  if (!items.length) return '';
  return (
    '## FAQ\n\n' +
    items
      .map((f: any) => `**${f.q}**\n\n${f.a}`)
      .join('\n\n')
  );
}

/**
 * Harga hanya dari angka rekaman. Angka rupiah lain di prosa diganti rujukan
 * yang tetap gramatikal — bukan dihapus begitu saja.
 */
function stripFabricatedRp(body: string): string {
  const ALLOWED = new Set([599000000, 3871000, 5000000, 45, 72, 20]);
  return body.replace(/Rp\s?([\d][\d.]*)\s?(ribu|juta|miliar)?/gi, (m, n, suf) => {
    let digits = Number(n.replace(/\./g, ''));
    if (/^ribu/i.test(suf || '')) digits *= 1_000;
    if (/^juta/i.test(suf || '')) digits *= 1_000_000;
    if (/^miliar/i.test(suf || '')) digits *= 1_000_000_000;
    // Luas bangunan/lahan sering ditulis "Rp" oleh model yang keliru — biarkan
    // angka kecil yang sah (45/72/20) lewat, sisanya dirujuk ke tabel.
    if (ALLOWED.has(digits)) return m;
    return 'angka pada tabel di atas';
  });
}

/** URL telanjang jadi markdown — model sering menulis path polos. */
function linkifyBareUrls(body: string): string {
  let out = body;
  out = out.replace(
    /(?<!\]\()(^|[\s(])(\/(?:simulasi-kpr|blog\/[a-z0-9-]+|agent(?:\/terms)?|privacy|nup|sale)\/?)/gm,
    (_m, pre, p) => `${pre}[${p.replace(/[/\-]/g, ' ').trim()}](${p})`,
  );
  out = out.replace(
    /(?<!\]\()((?:https?:\/\/)?(?:www\.)?(?:bps\.go\.id|ojk\.go\.id|pupr\.go\.id|bi\.go\.id|kemenkeu\.go\.id|(?:cimahi|bandungbarat)\.go\.id)[^\s)]*)/g,
    (u) => `[sumber resmi](${u.startsWith('http') ? u : 'https://' + u})`,
  );
  return out;
}

function escapeMd(s: any): string {
  if (!s) return '';
  return String(s).replace(/[|]/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
}

function stripFaqSection(body: string): string {
  return body.replace(/##\s*(?:FAQ|Pertanyaan[^\n]*)[\s\S]*$/i, '').trimEnd();
}

function injectAfterFirstH2(body: string, table: string): string {
  const FIRST_H2_BLOCK = /^##\s+[^\n]+\n([\s\S]*?)(?=\n## |\n*$)/m;
  const m = body.match(FIRST_H2_BLOCK);
  if (!m) return body + '\n\n' + table;
  const end = m.index + m[0].length;
  return body.slice(0, end) + '\n\n' + table + '\n\n' + body.slice(end);
}

/**
 * Gate anti-thin-content. Sengaja lebih keras dari sekadar "cukup kata":
 * 71 post impor lolos uji panjang tapi gagal uji keunikan, dan itulah yang
 * membuat Fase 10 langkah 0 ada. Bentuk diverifikasi terpisah di
 * lib/article-lint.mjs dan qc-uniqueness.mjs.
 */
export function validateMdx(content: string, keyword: string) {
  const errors: string[] = [];
  if (!content || !content.startsWith('---')) errors.push('Tanpa frontmatter');

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { ok: false, errors: ['Struktur frontmatter tidak valid'] };
  const fm = fmMatch[1];
  const body = fmMatch[2];

  const title = (fm.match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1] || '';
  if (!title) errors.push('title hilang');
  else if (title.length > 70) errors.push(`title terlalu panjang (${title.length}/70)`);

  const desc = (fm.match(/^description:\s*"?(.+?)"?\s*$/m) || [])[1] || '';
  if (!desc) errors.push('description hilang');
  else if (desc.length > 160) errors.push(`description terlalu panjang (${desc.length}/160)`);

  const slug = (fm.match(/^slug:\s*"?(.+?)"?\s*$/m) || [])[1] || '';
  if (!slug) errors.push('slug hilang');
  if (!/^status:\s*draft\s*$/m.test(fm)) errors.push('status harus draft');

  const faqCount = (body.match(/^\*\*[^*\n]{8,}\*\*\s*\n\n(?!\*)/gm) || []).length;
  if (faqCount < 5) errors.push(`FAQ = ${faqCount} (minimal 5)`);

  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 650) errors.push(`body terlalu pendek (${words}/650)`);
  if (words > 1400) errors.push(`body terlalu panjang (${words}/1400)`);

  const h2All = (body.match(/^##\s/gm) || []).length;
  const h2Template = (body.match(/^##\s*(?:FAQ|Baca juga)\s*$/gm) || []).length;
  const h2 = h2All - h2Template;
  if (h2 < 3 || h2 > 5) errors.push(`H2 naratif = ${h2} (harus 3-5)`);

  const linkRe = /\[([^\]]+)\]\(((?:https:\/\/valleycity\.id)?\/(?:blog\/|simulasi-kpr|agent|nup|sale|privacy|#)[^\)]*)\)/g;
  const internal = (body.match(linkRe) || []).length;
  if (internal < 3) errors.push(`link internal = ${internal} (minimal 3)`);
  if (!/\/simulasi-kpr\//.test(body)) errors.push('tidak ada link ke /simulasi-kpr/');

  const firstWords = body.slice(0, 220).toLowerCase();
  const kwFirst = (keyword || '').toLowerCase().split(/\s+/)[0];
  if (kwFirst && !firstWords.includes(kwFirst)) errors.push(`paragraf pertama tidak memuat "${kwFirst}"`);

  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(body)) errors.push('ada emoji');
  if (/^##\s*(kesimpulan|penutup|ringkasan|closing)\s*$/gim.test(body))
    errors.push('heading Kesimpulan/Penutup dilarang');

  // Angka rupiah di prosa: hanya angka rekaman yang boleh.
  const ALLOWED = new Set([599000000, 3871000, 5000000]);
  const bodyNoTable = body.replace(/^\|.*\|$/gm, '');
  const rpHits = [...bodyNoTable.matchAll(/Rp\s?(\d[\d.]*)\s?(ribu|juta|miliar)?/gi)].map((m) => {
    let n = Number(m[1].replace(/\./g, ''));
    if (/^ribu/i.test(m[2] || '')) n *= 1_000;
    if (/^juta/i.test(m[2] || '')) n *= 1_000_000;
    if (/^miliar/i.test(m[2] || '')) n *= 1_000_000_000;
    return n;
  });
  const rpBad = rpHits.filter((n) => !ALLOWED.has(n) && n !== 45 && n !== 72 && n !== 20);
  if (rpBad.length) errors.push(`angka rupiah di luar angka rekaman (Rp${rpBad[0]})`);

  const h2Lines = (body.match(/^##\s+.+$/gm) || []).filter(
    (h) => !/^##\s*(?:FAQ|Baca juga)\s*$/i.test(h),
  );
  const kwHead = (keyword || '').toLowerCase().split(/\s+/).slice(0, 2).join(' ');
  if (kwHead && !h2Lines.some((h) => h.toLowerCase().includes(kwHead)))
    errors.push(`keyword "${kwHead}" tidak ada di H2 mana pun`);

  const escKw = (keyword || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kwHits = escKw ? (body.toLowerCase().match(new RegExp(escKw, 'g')) || []).length : 0;
  if (kwHits < 3) errors.push(`density keyword rendah (${kwHits}, minimal 3)`);
  if (kwHits > 25) errors.push(`keyword stuffing (${kwHits}, maksimal 25)`);

  const allLinks = [...body.matchAll(/\[[^\]]+\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
  const ext = allLinks.filter((u) => !/^(https:\/\/)?(www\.)?valleycity\.id\//i.test(u));
  if (ext.length < 1) errors.push('tidak ada link eksternal ke sumber resmi');
  if (ext.length > 2) errors.push(`terlalu banyak link eksternal (${ext.length}, maksimal 2)`);

  return { ok: errors.length === 0, errors, title, desc, faqCount, h2Count: h2, words, internalLinks: internal };
}

/**
 * title + description + slug deterministik dari keyword.
 */
export function deriveMeta({ keyword, llmBody, category }: any) {
  const powers = [
    'Panduan Praktis',
    'Hitungan Jujur',
    'Yang Perlu Dicek',
    'Perbandingan Lapangan',
    'Hitungan Realistis',
  ];
  const hash = (keyword || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const num = 5 + (hash % 5);
  const kwWords = new Set((keyword || '').toLowerCase().split(/\s+/));
  const power =
    powers.find((p) => !p.toLowerCase().split(/\s+/).some((w) => kwWords.has(w))) ?? powers[0];

  let title = `${capitalize(keyword || 'rumah di Cimahi')}: ${num} ${power}`;
  if (title.length > 70) title = title.slice(0, 67) + '...';

  const firstSentence = stripTags((llmBody || '').split(/[.!?]/)[0] || '');
  let description = firstSentence.trim().slice(0, 130);
  if (description.length < 80) {
    description = `Panduan ${keyword} untuk pembeli rumah di Padalarang dan Cimahi — angka cicilan, biaya yang sering terlewat, dan cara membandingkannya.`;
  }
  if (description.length > 160) description = description.slice(0, 157) + '...';

  return {
    title,
    description,
    slug: slugify(keyword || 'artikel'),
    tags: mapTags(category),
  };
}

const ACRONYMS = new Set(['KPR', 'IMB', 'PBG', 'SHM', 'SHGB', 'BPHTB', 'DP', 'TMA', 'WIB']);

function stripTags(s: string): string {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/** slug artikel dari keyword — pola sama dengan 71 post lama (kecil, strip). */
function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

/** Taksonomi longgar: label bebas dipetakan ke beberapa tag tetap. */
function mapTags(category: any): string[] {
  const c = String(category || 'panduan').toLowerCase();
  if (/kpr|cicil|bunga|dp|angsuran/.test(c)) return ['kpr'];
  if (/harga|pricelist|biaya/.test(c)) return ['harga'];
  if (/lokasi|cimahi|padalarang|bandung|daerah/.test(c)) return ['lokasi'];
  if (/denah|tipe|spesifikasi|desain/.test(c)) return ['unit'];
  if (/legalitas|sertifikat|pbg|imb|ppjb|akta/.test(c)) return ['legalitas'];
  if (/agen|reseller|komisi/.test(c)) return ['agen'];
  return ['panduan'];
}

function capitalize(s: string): string {
  return String(s || '')
    .split(/\s+/)
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
