#!/usr/bin/env python3
"""Fase 10b — jsonld-validate: baseline markup untuk semua halaman indexable.

Urutannya penting. Site sekarang mengirim WebPage + BreadcrumbList lewat
components/Seo.astro untuk setiap halaman yang boleh di-index, dan halaman
noindex (/thank-you/, /agent/alt/) keluar dari sitemap. Validator harus
mencerminkan perjanjian yang sama:
  * target baseline = WebPage + BreadcrumbList, bukan [] lagi ([] hanya selama
    markupnya memang belum ada — menuliskannya sekarang akan membusuk jadi
    daftar kosong yang "membuat gate hijau");
  * halaman noindex tidak dituntut punya markup dan tidak dihitung sebagai gap:
    kami sendiri meminta Google mengabaikannya.
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/jsonld-validate.mjs'
src = open(P, encoding='utf-8').read()

EDITS = [
    # --- blok target lama -> hanya kekhususan per route; baseline diurus terpisah
    (
        """  // Artikel: markup utama + publisher bisa nested di dalam author/publisher.
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
        """  if (/^\\/blog\\/[^/]+\\/?$/.test(route)) return ['BlogPosting|Article'];
  return [];
}

/**
 * Baseline yang dijanjikan site ke crawler, untuk SEMUA halaman indexable:
 * src/components/Seo.astro mengirim WebPage (+ BreadcrumbList nested) lewat
 * lib/jsonld.ts. Ditagih di sini supaya "halaman baru lupa markup" gagal di
 * build, bukan diam-diam sampai traffic berikutnya tidak pernah datang.
 */
const BASELINE_TYPES = ['WebPage', 'BreadcrumbList'];""",
    ),
    # --- baca meta robots; halaman noindex tidak dituntut + tidak dihitung gap
    (
        """  const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || '';
  const blocks = extractJsonLd(html);
  if (!blocks.length) {
    warnings.push({ code: 'no_jsonld', msg: `halaman tanpa JSON-LD sama sekali: ${route}` });
    return { route, file, types, errors, warnings, blocks: 0, canonical };""",
        """  const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || '';
  // noindex = kami yang minta Google mengabaikan halaman ini. Menuntut markup
  // untuk halaman yang sengaja dikeluarkan dari indeks hanya menambah
  // peringatan yang tidak bisa dan tidak perlu diperbaiki.
  const robots = (html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
  const noindexed = /noindex/i.test(robots);
  const blocks = extractJsonLd(html);
  if (!blocks.length) {
    if (!noindexed) {
      warnings.push({ code: 'no_jsonld', msg: `halaman indexable tanpa JSON-LD sama sekali: ${route}` });
    }
    return { route, file, types, errors, warnings, blocks: 0, canonical, noindexed };""",
    ),
    # --- coverage: baseline + kekhususan, dilewat untuk noindex
    (
        """  // coverage vs plan §5.1
  const expected = expectedTypes(route);
  const uniq = new Set(types);""",
        """  // coverage vs target site
  const expected = noindexed ? [] : [...BASELINE_TYPES, ...expectedTypes(route)];
  const uniq = new Set(types);""",
    ),
]

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:70]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(src)
print('ok: baseline WebPage/BreadcrumbList ditagih, halaman noindex dikecualikan')
