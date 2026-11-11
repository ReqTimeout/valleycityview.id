#!/usr/bin/env node
/**
 * seo/llms.mjs — generate public/llms.txt + public/llms-full.txt untuk AI consumption.
 * Spec LANDING_SEO_SYSTEM.md §5: "llms.txt + llms-full.txt — generate di build (50 artikel + FAQ) untuk AI crawler".
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
import yaml from 'js-yaml';
const SITE = 'https://valleycity.id';

// ===== Helpers =====
function readFrontmatter(content) {
  // Markdown frontmatter: ---\nkey: value\n--- body
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fmText = match[1];
  const body = match[2];
  let fm = {};
  try {
    fm = yaml.load(fmText) || {};
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
  return { fm, body: strippedBody };
}

function escapeMd(s) {
  if (!s) return '';
  return s.replace(/[<>]/g, '');
}

function readSitemapUrls() {
  const sitemap = SITEMAP_PATH;
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
    if (!parsed || parsed.fm.draft) continue; // skip draft
    articles.push({
      slug: f.replace(/\.md$/, ''),
      title: parsed.fm.title || f,
      description: parsed.fm.description || '',
      category: parsed.fm.category || 'Lainnya',
      date: parsed.fm.date,
      faq: Array.isArray(parsed.fm.faq) ? parsed.fm.faq : [],
      body: parsed.body,
    });
  }
}

articles.sort((a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf());
const sitemapUrls = readSitemapUrls();

console.log(`articles: ${articles.length} published`);
console.log(`sitemap URLs: ${sitemapUrls.length}`);

// ===== Generate llms.txt (ringkas) =====
const llmsTxt = `# Valley Cityview

> Panel SMM reseller termurah dan tercepat di Indonesia. 8.270 layanan Instagram, TikTok, YouTube, Telegram, Spotify & SEO. Daftar reseller Rp50.000 include saldo Rp20.000 + harga reseller lebih murah di semua layanan.

## Money pages (${sitemapUrls.filter((u) => u.match(/\/(beli|smm-panel)-/)).length} — commercial intent)
${sitemapUrls
  .filter((u) => u.match(/\/(beli|smm-panel)-/) || u.match(/\/(layanan|reseller)/))
  .map((u) => `- [${u.replace(SITE, '')}](${u})`)
  .join('\n')}

## Blog (${articles.length} articles — informational)
${articles
  .map((a) => `- [${a.title}](${SITE}/blog/${a.slug}): ${a.description}`)
  .join('\n')}

## Optional
- [Sitemap](${SITE}/sitemap-index.xml)
- [Daftar reseller →](https://app.valleycity.id/daftar?mode=reseller)

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
const moneyUrls = sitemapUrls.filter((u) => u.match(/\/(beli|smm-panel)-/));
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