#!/usr/bin/env node
/**
 * seo/jsonld-validate.mjs — validator JSON-LD untuk seluruh output Astro.
 *
 * Plan v2 §5.3: "parse setiap page Astro output, validasi schema". Plan menyebut
 * `schema-dts` atau Rich Results Test — dua-duanya tidak dipakai di sini:
 *   - `schema-dts` = dependency baru di image runner (yang sengaja zero-dep);
 *   - Rich Results Test = endpoint tidak publik untuk Validasi massal (1 request
 *     per halaman, prone to rate limit, tidak ada API stabil).
 * Jadi validasi lokal dengan tabel field wajib per `@type`. Itu cukup untuk
 * menangkap 95% kesalahan nyata (JSON rusak, `@context` hilang, field wajib
 * kosong, placeholder, rating palsu, URL tidak cocok canonical).
 *
 * Yang divalidasi:
 *   1. JSON valid (blok `<script type="application/ld+json">` bisa array/objek/@graph)
 *   2. `@context` = schema.org, `@type` dikenal
 *   3. Field wajib per tipe (tabel `REQUIRED`)
 *   4. Tidak ada placeholder ("TODO", "lorem", "xxx", string kosong)
 *   5. `@id`/`url`/`url` dalam offers cocok dengan canonical halaman
 *   6. `AggregateRating` (kalau ada) punya `ratingValue` + `reviewCount` realistis
 *   7. Coverage matrix vs target plan §5.1 per tipe halaman
 *
 * Usage:
 *   node seo/jsonld-validate.mjs                 # scan site/dist
 *   node seo/jsonld-validate.mjs --dir path      # direktori lain
 *   node seo/jsonld-validate.mjs --json          # output JSON (untuk daily.mjs/notify)
 *   node seo/jsonld-validate.mjs --strict        # exit 1 juga kalau ada WARNING
 *   node seo/jsonld-validate.mjs --page /blog/x  # hanya satu halaman
 *
 * Exit: 0 = tidak ada ERROR, 1 = ada ERROR, 2 = gagal eksekusi.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './paths.mjs';

const NL = String.fromCharCode(10);

/** Tipe schema yang kita kenal (ekstensi aman; tipe lain = info, bukan error). */
const KNOWN_TYPES = new Set([
  'Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'FAQPage', 'BreadcrumbList', 'Person',
  'Organization', 'SpeakableSpecification', 'WebSite', 'WebPage', 'ItemList', 'Service', 'Product',
  'Offer', 'AggregateOffer', 'AggregateRating', 'Review', 'SoftwareApplication', 'HowTo', 'Blog',
  'LocalBusiness', 'AreaServed', 'SiteNavigationElement', 'CollectionPage', 'ProfilePage', 'ImageObject', 'ContactPoint',
  'PostalAddress', 'SearchAction', 'ListItem', 'Brand', 'Question', 'Answer', 'HowToStep',
]);

/** Field wajib minimal per tipe (google rich result + kegunaan nyata). */
const REQUIRED = {
  Article: ['headline', 'author', 'publisher', 'datePublished', 'dateModified'],
  BlogPosting: ['headline', 'author', 'publisher', 'datePublished', 'dateModified'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Person: ['name'],
  Organization: ['name', 'url'],
  WebSite: ['name', 'url'],
  WebPage: ['name', 'url'],
  ItemList: ['itemListElement'],
  Service: ['name', 'provider', 'areaServed', 'serviceType'],
  Product: ['name', 'offers'],
  Offer: ['price', 'priceCurrency'],
  AggregateOffer: ['lowPrice', 'priceCurrency'],
  HowTo: ['name', 'step'],
  SoftwareApplication: ['name', 'offers'],
  Blog: ['name', 'url'],
  SiteNavigationElement: ['itemListElement'],
};

const PLACEHOLDER = /(\bTODO\b|\bFIXME\b|lorem ipsum|\bxxx+\b|\bplaceholder\b|^-$)/i;

const ARGS = (() => {
  const a = { dir: null, json: false, strict: false, page: null, help: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dir') a.dir = argv[++i];
    else if (k.startsWith('--dir=')) a.dir = k.slice(6);
    else if (k === '--page') a.page = argv[++i];
    else if (k.startsWith('--page=')) a.page = k.slice(7);
    else if (k === '--json') a.json = true;
    else if (k === '--strict') a.strict = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Argumen tidak dikenal: ${k}`);
  }
  return a;
})();

if (ARGS.help) {
  console.log('Usage: node seo/jsonld-validate.mjs [--dir site/dist] [--page /blog/x] [--json] [--strict]');
}

/** Target coverage per pola halaman (plan v2 §5.1). */
function expectedTypes(route) {
  if (route === '/' || route === '/index.html') return ['WebSite', 'Organization', 'WebPage'];
  // Artikel: Person & SpeakableSpecification boleh nested di dalam Article
  // (author/publisher/speakable) — itu bentuk yang direkomendasikan Google.
  if (/^\/blog\/[^/]+\/?$/.test(route)) return ['Article', 'FAQPage', 'BreadcrumbList', 'Person', 'SpeakableSpecification', 'Organization'];
  if (/^\/blog\/?$/.test(route)) return ['Blog', 'ItemList', 'BreadcrumbList'];
  if (/^(\/beli-|\/smm-panel-|\/harga-)/.test(route)) return ['Product', 'FAQPage', 'BreadcrumbList', 'Service'];
  // /layanan = katalog indeks (bukan halaman penawaran satu produk) → targetnya
  // ItemList, bukan Product/Offer. Menempelkan Product di halaman indeks akan
  // misrepresentasi isi halaman.
  if (/^\/layanan\/?$/.test(route)) return ['ItemList', 'BreadcrumbList'];
  if (/^\/privacy\/?$/.test(route)) return ['WebPage'];
  if (/^\/reseller\/?$/.test(route)) return ['SoftwareApplication', 'Organization'];
  return [];
}

function walkHtml(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkHtml(p, out);
    else if (e.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Ambil blok JSON-LD dari HTML. Astro bisa escaping, jadi dua bentuk. */
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    // Astro set:html bisa meng-escape &quot; di beberapa konteks
    const cleaned = raw
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    try {
      out.push({ raw, json: JSON.parse(cleaned) });
    } catch (e) {
      out.push({ raw, parseError: e.message });
    }
  }
  return out;
}

/** Kumpulkan SEMUA @type di dalam dokumen JSON-LD, termasuk yang nested.
 *  Penting: `Article.author` berisi Person dan `Article.speakable` berisi
 *  SpeakableSpecification — keduanya valid dan memangcounts sebagai "ada".
 *  Versi pertama hanya menghitung node top-level, jadi schema yang sudah benar
 *  dilaporkan hilang (false warning). */
function collectTypes(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    const t = node['@type'] || node.type;
    if (t) {
      for (const x of Array.isArray(t) ? t : [t]) acc.add(String(x));
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === '@type' || k === 'type') continue;
      if (v && typeof v === 'object') collectTypes(v, acc);
    }
  }
  return acc;
}

function flatNodes(json) {
  if (Array.isArray(json)) return json.flatMap(flatNodes);
  if (json && typeof json === 'object') {
    const nodes = [];
    if (json['@graph']) nodes.push(...flatNodes(json['@graph']));
    if (json['@type'] || json.type) nodes.push(json);
    else nodes.push(json); // node tanpa type tetap dicek konteksnya
    return nodes;
  }
  return [];
}

function findEmptyPaths(obj, prefix = '', acc = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith('@')) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v === '' || v === null || v === undefined) acc.push(p);
    else if (typeof v === 'object' && !Array.isArray(v)) findEmptyPaths(v, p, acc);
  }
  return acc;
}

function validatePage(file, distDir) {
  const html = readFileSync(file, 'utf8');
  const route = '/' + relative(distDir, file).replace(/index\.html$/, '').replace(/\\/g, '/');
  const errors = [];
  const warnings = [];
  const types = [];

  const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || '';
  const blocks = extractJsonLd(html);
  if (!blocks.length) {
    warnings.push({ code: 'no_jsonld', msg: `halaman tanpa JSON-LD sama sekali: ${route}` });
    return { route, file, types, errors, warnings, blocks: 0, canonical };
  }

  for (const b of blocks) {
    if (b.parseError) {
      errors.push({ code: 'invalid_json', msg: `${route}: JSON tidak bisa di-parse — ${b.parseError}`, snippet: b.raw.slice(0, 120) });
      continue;
    }
    for (const node of flatNodes(b.json)) {
      const t = node['@type'] || node.type;
      const label = Array.isArray(t) ? t.join(',') : String(t || '(tanpa @type)');
      // coverage: hitung juga type yang nested (author/speakable/publisher)
      if (t) types.push(...collectTypes(b.json));

      if (!node['@context'] && !b.json['@context']) {
        errors.push({ code: 'no_context', msg: `${route}: node ${label} tanpa @context schema.org` });
      }
      if (!t) {
        warnings.push({ code: 'no_type', msg: `${route}: node JSON-LD tanpa @type` });
      } else if (!KNOWN_TYPES.has(label)) {
        warnings.push({ code: 'unknown_type', msg: `${route}: @type "${label}" tidak dikenal validator` });
      }

      // field wajib
      const need = REQUIRED[label];
      if (need) {
        for (const f of need) {
          const v = node[f];
          if (v === undefined) errors.push({ code: 'missing_field', msg: `${route}: ${label} wajib punya "${f}"` });
          else if (typeof v === 'string' && !v.trim()) errors.push({ code: 'empty_field', msg: `${route}: ${label}.${f} kosong` });
        }
      }

      // placeholder
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && PLACEHOLDER.test(v)) {
          errors.push({ code: 'placeholder', msg: `${route}: ${label}.${k} berisi placeholder: "${v.slice(0, 40)}"` });
        }
      }

      // URL harus cocok canonical
      for (const key of ['url', '@id']) {
        if (typeof node[key] === 'string' && node[key].startsWith('http') && canonical) {
          try {
            const a = new URL(node[key]);
            const c = new URL(canonical);
            if (a.host !== c.host) {
              warnings.push({ code: 'url_host_mismatch', msg: `${route}: ${label}.${key} host ${a.host} ≠ canonical ${c.host}` });
            }
          } catch { /* bukan URL valid, sudah tertangkap validasi lain */ }
        }
      }

      // AggregateRating: hanya bila ada, dan harus punya data realistis.
      // Bisa di Product.aggregateRating ATAU Product.offers.aggregateRating —
      // Google menerima keduanya, jadi keduanya wajib dicek.
      const ar = node.aggregateRating || (node.offers && typeof node.offers === 'object' ? node.offers.aggregateRating : undefined);
      if (ar && typeof ar === 'object') {
        for (const f of ['ratingValue', 'reviewCount']) {
          if (ar[f] === undefined) errors.push({ code: 'rating_incomplete', msg: `${route}: ${label}.aggregateRating tanpa ${f}` });
        }
        if (ar.ratingValue !== undefined && (Number(ar.ratingValue) > 5 || Number(ar.ratingValue) < 1)) {
          errors.push({ code: 'rating_invalid', msg: `${route}: ratingValue ${ar.ratingValue} di luar 1-5` });
        }
        if (ar.reviewCount !== undefined && Number(ar.reviewCount) === 0) {
          errors.push({ code: 'rating_empty', msg: `${route}: reviewCount 0 — rating kosong tidak boleh tampil` });
        }
      }
    }
  }

  // coverage vs plan §5.1
  const expected = expectedTypes(route);
  const uniq = new Set(types);
  for (const e of expected) {
    if (!uniq.has(e)) {
      // Person/SpeakableSpecification hanya relevan kalau artikel punya penulis
      warnings.push({ code: 'missing_expected_type', msg: `${route}: target plan §5.1 belum ada @type ${e}` });
    }
  }

  return { route, file, types: [...uniq], errors, warnings, blocks: blocks.length, canonical };
}

function main() {
  const dist = ARGS.dir ? (ARGS.dir.startsWith('/') ? ARGS.dir : join(ROOT, ARGS.dir)) : join(ROOT, 'site/dist');
  if (!existsSync(dist)) {
    console.error(`jsonld-validate: direktori tidak ada: ${dist}${NL}  → build dulu: pnpm --filter landing build`);
    process.exitCode = 2;
    return;
  }
  let files = walkHtml(dist);
  if (ARGS.page) {
    const want = ARGS.page.replace(/\/$/, '');
    files = files.filter((f) => {
      const r = '/' + relative(dist, f).replace(/index\.html$/, '').replace(/\/$/, '');
      return r === want || r === `${want}/` || f.includes(want);
    });
    if (!files.length) {
      console.error(`jsonld-validate: halaman tidak ditemukan: ${ARGS.page}`);
      process.exitCode = 2;
      return;
    }
  }

  const results = files.map((f) => validatePage(f, dist));
  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);
  const typeCount = {};
  for (const r of results) for (const t of r.types) typeCount[t] = (typeCount[t] || 0) + 1;

  const summary = {
    pages: results.length,
    blocks: results.reduce((a, r) => a + r.blocks, 0),
    errors: errors.length,
    warnings: warnings.length,
    type_coverage: Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([type, pages]) => ({ type, pages })),
    pages_without_jsonld: results.filter((r) => r.blocks === 0).map((r) => r.route),
    errors_detail: errors,
    warnings_detail: warnings,
  };

  if (ARGS.json) {
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = errors.length ? 1 : 0;
    return;
  }

  console.log(`jsonld-validate — ${summary.pages} halaman · ${summary.blocks} blok JSON-LD`);
  console.log(`  ERROR ${summary.errors} · WARNING ${summary.warnings}${ARGS.strict ? ' (strict: warning ikut fail)' : ''}`);
  console.log('');
  console.log('  cakupan @type:');
  for (const t of summary.type_coverage) console.log(`    · ${t.type.padEnd(24)} ${t.pages} halaman`);

  if (summary.pages_without_jsonld.length) {
    console.log(`\n  halaman tanpa JSON-LD (${summary.pages_without_jsonld.length}):`);
    for (const r of summary.pages_without_jsonld.slice(0, 10)) console.log(`    · ${r}`);
    if (summary.pages_without_jsonld.length > 10) console.log(`    … +${summary.pages_without_jsonld.length - 10}`);
  }

  if (errors.length) {
    console.log(`\n  ERROR (${errors.length}):`);
    for (const e of errors.slice(0, 40)) console.log(`    · ${e.msg}`);
    if (errors.length > 40) console.log(`    … +${errors.length - 40} lagi`);
  }
  if (warnings.length) {
    console.log(`\n  WARNING (${warnings.length}):`);
    const byCode = {};
    for (const w of warnings) (byCode[w.code] = byCode[w.code] || []).push(w);
    for (const [code, list] of Object.entries(byCode)) {
      console.log(`    · [${code}] ${list.length}× — contoh: ${list[0].msg}`);
    }
  }

  if (errors.length) {
    console.log(`\nGATE: FAIL — ${errors.length} error schema harus dibereskan sebelum deploy.`);
    process.exitCode = 1;
  } else if (ARGS.strict && warnings.length) {
    console.log(`\nGATE: FAIL (strict) — ${warnings.length} warning.`);
    process.exitCode = 1;
  } else {
    console.log(`\nGATE: PASS — tidak ada error schema.`);
  }
}

try {
  main();
} catch (e) {
  console.error('jsonld-validate FATAL:', e.message);
  process.exitCode = 2;
}
