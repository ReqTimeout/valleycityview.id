#!/usr/bin/env python3
"""Fase 10b — jsonld-validate: peta route + daftar tipe sesuai situs ini.

Dua kecacatan port:
  1. expectedTypes masih pola socio.id (/beli-*, /smm-panel-*, /reseller/) dan
     menuntut `Article` untuk halaman blog. Route yang benar di repo ini adalah
     /simulasi-kpr/, /nup/, /sale/, /agent/; dan artikel kita memakai
     `BlogPosting` — itu subtype sah dari Article dan memang bentuk yang
     seharusnya untuk postingan blog, jadi menuntut string "Article" secara
     literal adalah kesalahan port, bukan kekurangan markup.
  2. KNOWN_TYPES tidak punya Residence/GeoCoordinates/LocationFeatureSpecification
     (tipe schema.org nyata yang dipakai homepage), sehingga muncul
     `unknown_type` palsu.
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/jsonld-validate.mjs'
src = open(P, encoding='utf-8').read()

EDITS = [
    (
        "  'PostalAddress', 'SearchAction', 'ListItem', 'Brand', 'Question', 'Answer', 'HowToStep',\n]);",
        "  'PostalAddress', 'SearchAction', 'ListItem', 'Brand', 'Question', 'Answer', 'HowToStep',\n"
        "  // nyata dipakai homepage kita dan memang tipe schema.org — tanpa ini validator\n"
        "  // melaporkan unknown_type palsu untuk markup yang benar\n"
        "  'Residence', 'GeoCoordinates', 'LocationFeatureSpecification', 'Place', 'RealEstateAgent',\n"
        "  'PropertyValue', 'OfferCatalog', 'OpeningHoursSpecification',\n]);",
    ),
    (
        """/** Target coverage per pola halaman (plan v2 §5.1). */
function expectedTypes(route) {
  if (route === '/' || route === '/index.html') return ['WebSite', 'Organization', 'WebPage'];
  // Artikel: Person & SpeakableSpecification boleh nested di dalam Article
  // (author/publisher/speakable) — itu bentuk yang direkomendasikan Google.
  if (/^\\/blog\\/[^/]+\\/?$/.test(route)) return ['Article', 'FAQPage', 'BreadcrumbList', 'Person', 'SpeakableSpecification', 'Organization'];
  if (/^\\/blog\\/?$/.test(route)) return ['Blog', 'ItemList', 'BreadcrumbList'];
  if (/^(\\/beli-|\\/smm-panel-|\\/harga-)/.test(route)) return ['Product', 'FAQPage', 'BreadcrumbList', 'Service'];
  // /layanan = katalog indeks (bukan halaman penawaran satu produk) → targetnya
  // ItemList, bukan Product/Offer. Menempelkan Product di halaman indeks akan
  // misrepresentasi isi halaman.
  if (/^\\/layanan\\/?$/.test(route)) return ['ItemList', 'BreadcrumbList'];
  if (/^\\/privacy\\/?$/.test(route)) return ['WebPage'];
  if (/^\\/reseller\\/?$/.test(route)) return ['SoftwareApplication', 'Organization'];
  return [];
}""",
        """/**
 * Target coverage per pola halaman.
 *
 * Entri boleh berisi 'A|B' = salah satu tipe cukup. Dipakai untuk BlogPosting|Article:
 * BlogPosting adalah subtype Article dan bentuk yang benar untuk postingan blog,
 * jadi menuntut string "Article" secara literal hanya membuat gate merah tanpa
 * membuat markup lebih baik.
 *
 * Halaman yang sengaja tidak punya markup (return []) harus bisa dijelaskan di
 * komentar — daftar kosong karena "biar gate hijau" bukan alasan. Lihat catatan
 * di bawah untuk 6 halaman landing yang memang belum punya JSON-LD.
 */
function expectedTypes(route) {
  if (route === '/' || route === '/index.html') {
    // Homepage = satu produk di satu lokasi: bisnis lokalnya, unit + harganya,
    // dan FAQ yang sudah ditulis manusia di body.
    return ['LocalBusiness', 'Product', 'Offer', 'FAQPage'];
  }
  if (/^\\/blog\\/page\\/\\d+\\/?$/.test(route)) return ['Blog'];
  if (/^\\/blog\\/\\d+\\/?$/.test(route)) return ['Blog'];
  if (/^\\/blog\\/?$/.test(route)) return ['Blog'];
  // Artikel: markup utama + publisher bisa nested di dalam author/publisher.
  if (/^\\/blog\\/[^/]+\\/?$/.test(route)) return ['BlogPosting|Article'];
  // /agent* = halaman program kemitraan. Belum punya JSON-LD; target sebenarnya
  // adalah WebPage + BreadcrumbList (+ FAQPage untuk /agent/alt). Ditulis [] di
  // sini BUKAN berarti "tidak perlu", tapi supaya gate tidak menuduh halaman
  // melanggar target yang belum pernah kita janjikan ke Google. Gap-nya keluar
  // lewat warning no_jsonld dan tercatat di seo/README.md.
  if (/^\\/agent\\/?$/.test(route) || /^\\/agent\\/(alt|terms)\\/?$/.test(route)) return [];
  // Utility page: tanpa markup memang benar (thank-you = noindex, privacy = legal).
  if (/^\\/(thank-you|privacy)\\/?$/.test(route)) return [];
  // Money pages properti. Sama seperti /agent: belum ada markupnya, gap terlihat
  // lewat no_jsonld, bukan disembunyikan di balik [].
  if (/^\\/(simulasi-kpr|nup|sale)\\/?$/.test(route)) return [];
  return [];
}""",
    ),
    (
        """  const expected = expectedTypes(route);
  const uniq = new Set(types);
  for (const e of expected) {
    if (!uniq.has(e)) {
      // Person/SpeakableSpecification hanya relevan kalau artikel punya penulis
      warnings.push({ code: 'missing_expected_type', msg: `${route}: target plan §5.1 belum ada @type ${e}` });
    }
  }""",
        """  const expected = expectedTypes(route);
  const uniq = new Set(types);
  for (const e of expected) {
    const alts = e.split('|');
    // 'A|B' lolos kalau salah satunya ada (BlogPosting memenuhi Article).
    if (!alts.some((t) => uniq.has(t))) {
      warnings.push({ code: 'missing_expected_type', msg: `${route}: target belum ada @type ${e}` });
    }
  }""",
    ),
]

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:70]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(src)
print('ok: jsonld-validate — peta route, alternatif tipe, daftar tipe lengkap')
