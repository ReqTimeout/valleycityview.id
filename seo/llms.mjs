#!/usr/bin/env node
/**
 * seo/llms.mjs — generate public/llms.txt + public/llms-full.txt untuk AI consumption.
 * Dihasilkan saat build (lihat `seo/README.md`): llms.txt = peta ringkas,
 * llms-full.txt = isi per artikel untuk AI ingest.
 *
 * Format spec: https://llmstxt.org
 *  - llms.txt: ringkas + link ke llms-full.txt
 *  - llms-full.txt: full content (title, description, faq, internal links) — untuk AI ingest
 *
 * Token: 0 AI. Pure data dari Markdown frontmatter + sitemap.
 * Usage: node seo/llms.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, BLOG_DIR, PUBLIC_DIR, SITEMAP_PATH } from './paths.mjs';
import { isLive } from './lib/live-posts.mjs';
import { createRequire } from 'node:module';

// Dual resolver seperti lib/article-lint: `js-yaml` kalau ada, kalau tidak
// `yaml` milik Astro. Import langsung 'js-yaml' akan membuat script ini
// crash sebelum sempat memutuskan apa pun.
const requireSite = createRequire(join(ROOT, 'site', 'noop.js'));
let yaml = null;
try {
  yaml = requireSite('js-yaml');
} catch {
  try {
    const y = requireSite('yaml');
    yaml = { load: (s) => y.parse(s) };
  } catch {
    yaml = null;
  }
}
import {
  SITE,
  BRAND,
  DESCRIPTION,
  ADDRESS,
  EMAIL,
  WHATSAPP_DISPLAY,
  MONEY_PAGES,
} from './site.mjs';

// ===== Helpers =====
function readFrontmatter(content) {
  // Markdown frontmatter: ---\nkey: value\n--- body
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fmText = match[1];
  const body = match[2];
  let fm = {};
  try {
    fm = yaml ? yaml.load(fmText) || {} : null;
    if (!fm) return null; // tidak ada parser YAML -> skip, jangan karang
  } catch {
    return null; // frontmatter YAML rusak -> skip file (llms tidak crash)
  }
  // Strip inline Markdown (##, **, dll) untuk AI ingestion
  const strippedBody = body
    .replace(/<[^>]+>/g, '') // strip JSX/HTML
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip Markdown link → text
    .replace(/[*_`~]+/g, '') // strip formatting chars
    .replace(/^#+\s*/gm, '') // strip heading prefix
    .trim();
  return { fm, body: strippedBody, bodyRaw: body };
}

/**
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
  const m = body.match(/^##\s*(?:FAQ|Pertanyaan[^\n]*)\s*\n([\s\S]*?)(?=\n## |\s*$)/im);
  if (!m) return [];
  const items = [];
  const re = /\*\*([^*]+\?)[*]+\s*\n+([\s\S]*?)(?=\n\s*\*\*[^*]+\?|\s*$)/g;
  let x;
  while ((x = re.exec(m[1])) !== null) {
    const q = x[1].trim();
    const a = x[2].trim().split(NL + NL)[0].trim();
    if (q && a) items.push({ q, a });
  }
  return items.slice(0, 5);
}

function escapeMd(s) {
  if (!s) return '';
  return s.replace(/[<>]/g, '');
}

function readSitemapUrls() {
  const sitemap = SITEMAP_PATH;
  // Best-effort: pada checkout bersih belum ada dist/. Bagian llms.txt yang
  // memakai daftar URL tetap benar karena money page datang dari registry.
  if (!existsSync(sitemap)) return [];
  const xml = readFileSync(sitemap, 'utf8');
  const urls = [];
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  for (const m of matches) urls.push(m[1]);
  return urls;
}

// ===== Build =====
const articles = [];
if (existsSync(BLOG_DIR)) {
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const raw = readFileSync(join(BLOG_DIR, f), 'utf8');
    const parsed = readFrontmatter(raw);
    // Predikat tayang satu sumber dengan route Astro + mesh-build (lihat lib/live).
    if (!parsed || !isLive(parsed.fm)) continue;
    articles.push({
      slug: f.replace(/\.md$/, ''),
      title: parsed.fm.title || f,
      description: parsed.fm.description || '',
      category: (parsed.fm.tags || []).join(', ') || 'panduan',
      date: parsed.fm.date,
      // FAQ di collection ini ada di BODY (## FAQ + pasangan **tanya**/jawab),
      // bukan di frontmatter. Mengambil dari fm.faq = selalu kosong.
      faq: faqFromBody(parsed.bodyRaw),
      body: parsed.body,
    });
  }
}

articles.sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());
const sitemapUrls = readSitemapUrls();

// Registry money page datang dari site.mjs — tidak ada daftar kedua di sini.
// Entri ber-`#` adalah section homepage, jadi wajar kalau tidak muncul di
// sitemap: yang kami tampilkan ke crawler memang URL kanonik section-nya.
const moneyPages = MONEY_PAGES.map((p) => ({ ...p, url: `${SITE}${p.url}` }));

console.log(`articles: ${articles.length} published`);
console.log(`sitemap URLs: ${sitemapUrls.length}`);

// ===== Generate llms.txt (ringkas) =====
const llmsTxt = `# ${BRAND}

> ${DESCRIPTION}

## Halaman komersial (${moneyPages.length} — intent beli)
${moneyPages.map((p) => `- [${p.anchor}](${p.url})`).join('\n')}

## Blog (${articles.length} artikel — informatif)
${articles
  .map((a) => `- [${a.title}](${SITE}/blog/${a.slug}): ${a.description}`)
  .join('\n')}

## Kontak
- WhatsApp: ${WHATSAPP_DISPLAY}
- Email: ${EMAIL}
- Lokasi: ${ADDRESS.street}, ${ADDRESS.city}, ${ADDRESS.region} ${ADDRESS.postalCode}, ${ADDRESS.countryName}

Full content (titles + FAQ + body) → [llms-full.txt](${SITE}/llms-full.txt)
`;

writeFileSync(`${PUBLIC_DIR}/llms.txt`, llmsTxt);
console.log(`Wrote public/llms.txt (${llmsTxt.length} bytes)`);

// ===== Generate llms-full.txt (per-article content) =====
const sections = [];
sections.push(`# Valley Cityview — Full Content for LLM ingestion
# Generated: ${new Date().toISOString().slice(0, 10)}
# Articles: ${articles.length}
# Sitemap URLs: ${sitemapUrls.length}
#
# Format: # <slug> → metadata + FAQ + body. Plain markdown, no JSX.
# Aturan pakai: konsumsi untuk knowledge base, RAG, AI Overview. Hindari fabricate number di luar data yang ada.

`);

// Money pages (ringkas — bukan full body)
const moneyUrls = moneyPages.map((p) => p.url);
sections.push(`## Money Pages (commercial — ${moneyUrls.length} high-intent URLs)
${moneyUrls.map((u) => `- ${u}`).join('\n')}

`);

// Articles — full
sections.push(`## Articles (${articles.length})\n`);
for (const a of articles) {
  sections.push(`### ${a.title}
URL: ${SITE}/blog/${a.slug}
Category: ${a.category}
Published: ${new Date(a.date).toISOString().slice(0, 10)}
Description: ${escapeMd(a.description)}

FAQ:
${a.faq.map((f, i) => `  ${i + 1}. ${escapeMd(f.q)}\n     → ${escapeMd(f.a)}`).join('\n')}

Body:
${escapeMd(a.body).slice(0, 3000)}
${a.body.length > 3000 ? '\n[... truncated, full article at ' + SITE + '/blog/' + a.slug + ']' : ''}

---
`);
}

const llmsFullTxt = sections.join('\n');
writeFileSync(`${PUBLIC_DIR}/llms-full.txt`, llmsFullTxt);
console.log(`Wrote public/llms-full.txt (${llmsFullTxt.length} bytes)`);