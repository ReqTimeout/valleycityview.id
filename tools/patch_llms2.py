#!/usr/bin/env python3
"""Fase 10b — buang sisa socio.id dari output seo/llms.mjs.

llms.txt adalah berkas yang dibaca AI crawler untuk MENJAWAB pertanyaan calon
pembeli. Template lama masih berisi "Panel SMM reseller ... 8.270 layanan
Instagram" dan tautan app.valleycity.id/daftar?mode=reseller yang tidak ada di
situs ini — keduanya klaim palsu untuk domain properti.
"""
import sys
from pathlib import Path

P = str(Path(__file__).resolve().parents[1]) + '/seo/llms.mjs'
src = open(P, encoding='utf-8').read()

EDITS = [
    (
        "import { SITE, BRAND, TAGLINE, ADDRESS, PRICING, MONEY_PAGES } from './site.mjs';",
        "import {\n"
        "  SITE,\n"
        "  BRAND,\n"
        "  DESCRIPTION,\n"
        "  ADDRESS,\n"
        "  EMAIL,\n"
        "  WHATSAPP_DISPLAY,\n"
        "  MONEY_PAGES,\n"
        "} from './site.mjs';",
    ),
    (
        "articles.sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());\n"
        "const sitemapUrls = readSitemapUrls();",
        "articles.sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());\n"
        "const sitemapUrls = readSitemapUrls();\n"
        "\n"
        "// Registry money page datang dari site.mjs — tidak ada daftar kedua di sini.\n"
        "// Entri ber-`#` adalah section homepage, jadi wajar kalau tidak muncul di\n"
        "// sitemap: yang kami tampilkan ke crawler memang URL kanonik section-nya.\n"
        "const moneyPages = MONEY_PAGES.map((p) => ({ ...p, url: `${SITE}${p.url}` }));",
    ),
]

for old, new in EDITS:
    if src.count(old) != 1:
        print(f'GAGAL: penanda cocok {src.count(old)}x: {old[:60]!r}')
        sys.exit(1)
    src = src.replace(old, new, 1)

# --- blok llms.txt diganti utuh (dari marker sampai penutup backtick-nya) ---
START = 'const llmsTxt = `# Valley Cityview'
END = 'Full content (titles + FAQ + body) → [llms-full.txt](${SITE}/llms-full.txt)\n`;'
i = src.index(START)
j = src.index(END, i) + len(END)

NEW_LLMS = """const llmsTxt = `# ${BRAND}

> ${DESCRIPTION}

## Halaman komersial (${moneyPages.length} — intent beli)
${moneyPages.map((p) => `- [${p.anchor}](${p.url})`).join('\\n')}

## Blog (${articles.length} artikel — informatif)
${articles
  .map((a) => `- [${a.title}](${SITE}/blog/${a.slug}): ${a.description}`)
  .join('\\n')}

## Kontak
- WhatsApp: ${WHATSAPP_DISPLAY}
- Email: ${EMAIL}
- Lokasi: ${ADDRESS.street}, ${ADDRESS.city}, ${ADDRESS.region} ${ADDRESS.postalCode}, ${ADDRESS.countryName}

Full content (titles + FAQ + body) → [llms-full.txt](${SITE}/llms-full.txt)
`;"""

src = src[:i] + NEW_LLMS + src[j:]

# --- money pages di llms-full.txt: regex socio -> registry ---
old_money = "const moneyUrls = sitemapUrls.filter((u) => u.match(/\\/(beli|smm-panel)-/));"
if src.count(old_money) != 1:
    print(f'GAGAL: moneyUrls cocok {src.count(old_money)}x')
    sys.exit(1)
src = src.replace(
    old_money,
    "const moneyUrls = moneyPages.map((p) => p.url);",
    1,
)

open(P, 'w', encoding='utf-8').write(src)
print('ok: llms.txt + money pages ditulis ulang dari registry situs')
