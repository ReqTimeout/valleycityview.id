#!/usr/bin/env python3
"""Fase 10b — perbaiki seo/llms.mjs: faqFromBody yang belum didefinisikan +
buang sisa template socio.id (SMM/panel/reseller) dari llms.txt.

Pakai Python, bukan tool edit, karena berkas ini penuh regex literal dengan
backslash; tool edit di sesi ini sudah tiga kali memecah '\\n' jadi baris nyata.
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/llms.mjs'
src = open(P, encoding='utf-8').read()

EDITS = [
    # 1) impor: butuh registry money page + angka rekaman, bukan teks karangan
    (
        "import { SITE, BRAND } from './site.mjs';",
        "import { SITE, BRAND, TAGLINE, ADDRESS, PRICING, MONEY_PAGES } from './site.mjs';",
    ),
    # 2) docstring: spec socio tidak ada di repo ini
    (
        ' * Spec LANDING_SEO_SYSTEM.md §5: "llms.txt + llms-full.txt — generate di build (50 artikel + FAQ) untuk AI crawler".',
        ' * Dihasilkan saat build (lihat `seo/README.md`): llms.txt = peta ringkas,\n'
        ' * llms-full.txt = isi per artikel untuk AI ingest.',
    ),
    # 3) fungsi baru: FAQ dibaca dari BODY bentuk renderFaq() di prompts.ts
    (
        'function escapeMd(s) {',
        '''/**
 * FAQ dibaca dari body, bukan frontmatter — collection ini tidak punya field
 * `faq:`, dan generator menulis section-nya lewat renderFaq() di prompts.ts:
 *
 *   ## FAQ
 *   **Pertanyaan?**
 *   <paragraf jawaban>
 *
 * 54 post impor belum punya section FAQ -> hasilnya [] dan itu benar:
 * mengarang FAQ di sini berarti mengirim jawaban yang tidak pernah ditulis
 * manusia ke AI crawler.
 */
function faqFromBody(body) {
  const NL = String.fromCharCode(10);
  const m = body.match(/^##\\s*(?:FAQ|Pertanyaan[^\\n]*)\\s*\\n([\\s\\S]*?)(?=\\n## |\\s*$)/im);
  if (!m) return [];
  const items = [];
  const re = /\\*\\*([^*]+\\?)[*]+\\s*\\n+([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*]+\\?|\\s*$)/g;
  let x;
  while ((x = re.exec(m[1])) !== null) {
    const q = x[1].trim();
    const a = x[2].trim().split(NL + NL)[0].trim();
    if (q && a) items.push({ q, a });
  }
  return items.slice(0, 5);
}

function escapeMd(s) {''',
    ),
]

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:60]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(src)
print('ok: 3 edit llms.mjs (impor, docstring, faqFromBody)')
