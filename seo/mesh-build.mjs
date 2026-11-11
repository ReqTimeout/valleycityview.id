#!/usr/bin/env node
/**
 * seo/mesh-build.mjs — bangun internal mesh antar artikel (plan v2 §6.1 + §1.3).
 *
 * Mesh rules (plan §1.3) yang diimplementasikan, dalam urutan prioritas, dan
 * DIBATAS 3 slot karena `site/src/content.config.ts` menetapkan
 * `related: z.array(reference("blog")).max(3)`:
 *   1. **Pilar** — artikelku belong ke pillar mana (dari seo/clusters.json).
 *   2. **Sibling** — 1-2 artikel lain di pilar yang sama; utamakan kategori sama.
 *   3. **Kota tetangga** — untuk artikel geo: kota lain di provinsi yang sama
 *      (plan §1.3: "1-2 kota tetangga se-provinsi").
 *
 * ATURAN KERAS: target **harus published**. `blog/[slug].astro` memfilter
 * `!data.draft` di getStaticPaths, jadi artikel draft TIDAK punya halaman →
 * link ke draft = broken link produksi (dan `reference("blog")` akan resolve
 * ke entri yang tidak pernah di-build).
 *
 * Menulis ke frontmatter `related:` (format yang sudah dipakai generate.mjs:
 * YAML list of slug). Idempoten: blok `related:` yang ada diganti utuh.
 *
 * Usage:
 *   node seo/mesh-build.mjs               # LAPORAN saja (default, aman)
 *   node seo/mesh-build.mjs --write       # tulis related[] ke frontmatter
 *   node seo/mesh-build.mjs --slug x      # hanya satu artikel
 *   node seo/mesh-build.mjs --all        # ikut sentuh draft (default: published only)
 *   node seo/mesh-build.mjs --json       # output JSON
 *   node seo/mesh-build.mjs --no-reciprocal  # matikan jaminan link 2-arah
 *   node seo/mesh-build.mjs --reset         # buang related[] eksisting, hitung ulang penuh
 *
 * Resiprokal (default ON): greedy pick di atas tidak menjamin A->B berarti
 * B->A, karena A dan B bisa punya kandidat berbeda. Mesh berarti jalannya dua
 * arah, jadi setiap edge A->B yang belum dibalas akan dibalas balik oleh B
 * selama B masih punya slot kosong (fixpoint, maks 3 putaran).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR, ROOT } from './paths.mjs';

const NL = String.fromCharCode(10);
// clusters.json ada di seo/ (bukan di samping BLOG_DIR) — pakai ROOT supaya
// tidak salah path kalau BLOG_DIR di-override lewat SEO_CONTENT_DIR.
const CLUSTERS_PATH = join(ROOT, 'seo', 'clusters.json');
const CITIES_PATH = join(ROOT, 'seo', 'cities.json');
const MAX_RELATED = 3; // batas schema: content.config.ts max(3)

const ARGS = (() => {
  const a = { write: false, all: false, json: false, slug: null, help: false, reciprocal: true, reset: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') a.write = true;
    else if (k === '--all') a.all = true;
    else if (k === '--no-reciprocal') a.reciprocal = false;
    else if (k === '--reset') a.reset = true;
    else if (k === '--json') a.json = true;
    else if (k === '--slug') a.slug = argv[++i];
    else if (k.startsWith('--slug=')) a.slug = k.slice(7);
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Argumen tidak dikenal: ${k}`);
  }
  return a;
})();

if (ARGS.help) {
  console.log('Usage: node seo/mesh-build.mjs [--write] [--slug S] [--all] [--json] [--no-reciprocal]');
  console.log('  (default) hanya laporan — tidak menulis file');
  console.log('  --write     tulis related[] ke frontmatter artikel');
  console.log('  --all       ikut memproses draft (default: published saja)');
  console.log('  --slug S    hanya satu slug');
}

/** Baca artikel: slug, draft?, kategori, judul, related lama. */
function readArticles() {
  if (!existsSync(BLOG_DIR)) throw new Error(`BLOG_DIR tidak ada: ${BLOG_DIR}`);
  const out = [];
  for (const f of readdirSync(BLOG_DIR).filter((x) => x.endsWith('.md'))) {
    const slug = f.replace(/\.md$/, '');
    const src = readFileSync(join(BLOG_DIR, f), 'utf8');
    const fmEnd = src.indexOf(NL + '---', 3);
    const fm = fmEnd > 0 ? src.slice(0, fmEnd) : '';
    out.push({
      slug,
      file: join(BLOG_DIR, f),
      draft: /^status:[ \t]*draft/m.test(fm),
      title: (fm.match(/^title:[ \t]*"?([^"\n]*)"?/m) || [])[1]?.trim() || slug,
      category: (fm.match(/^category:[ \t]*"?([^"\n]*)"?/m) || [])[1]?.trim() || '',
      related: parseRelated(fm),
    });
  }
  return out;
}

// Item list YAML SELALU "  - x" (dash + spasi). Polanya harus mewajibkan spasi
// setelah dash: kalau tidak, baris penutup frontmatter "---" ikut regarded
// sebagai list item ("-" + "--") dan HILANG saat ditulis — sempat merusak 5 file
// Markdown sebelum guard di bawah dibuat.
const RELATED_RE = /^related:[ \t]*(\[[^\]]*\]|(?:\n[ \t]+-[ \t]+[^\n]*)*)/m;

/** related lama dari frontmatter (YAML list). */
function parseRelated(fm) {
  const m = fm.match(RELATED_RE);
  if (!m) return [];
  return [...m[1].matchAll(/-\s*([a-z0-9][a-z0-9-]*)/g)].map((x) => x[1]);
}

/** Ganti blok `related:` utuh (aman: berhenti di key berikutnya atau '---'). */
function replaceRelated(src, slugs) {
  const block = slugs.length
    ? `related:${NL}${slugs.map((s) => `  - ${s}`).join(NL)}`
    : 'related: []';
  if (RELATED_RE.test(src)) return src.replace(RELATED_RE, block);
  // belum ada key related → sisipkan sebelum baris '---' penutup frontmatter
  const close = src.indexOf(NL + '---', 3);
  if (close < 0) throw new Error('frontmatter tidak ditemukan');
  return src.slice(0, close) + NL + block + src.slice(close);
}

/** Manifest pillar → cluster (dari 4.2). Kalau file tidak ada, mesh tanpa pilar. */
function loadManifest() {
  if (!existsSync(CLUSTERS_PATH)) return null;
  try {
    const m = JSON.parse(readFileSync(CLUSTERS_PATH, 'utf8'));
    const slugToPillar = new Map();
    const metaBySlug = new Map();
    for (const p of m.pillars || []) {
      for (const c of p.clusters_meta || []) {
        slugToPillar.set(c.slug, p.id);
        metaBySlug.set(c.slug, { pillar: p.id, pillarSlug: p.slug, geo: c.geo || null, provinsi: c.provinsi || null, category: null });
      }
    }
    return { slugToPillar, metaBySlug, pillarsById: new Map((m.pillars || []).map((p) => [p.id, p])) };
  } catch (e) {
    console.error(`mesh-build: clusters.json tidak bisa dibaca — lanjut tanpa peta pilar (${e.message})`);
    return null;
  }
}

/**
 * Deteksi geo artikel + kota tetangga.
 *
 * PENTING: `seo/clusters.json` TIDAK menyimpan field geo/provinsi (clusters_meta
 * cuma punya slug/keyword/status/hasArticle/draft/priority) — 864 cluster geo ada
 * di P10 tapi tanpa info kota. Sumber satu-satunya yang punya `provinsi` adalah
 * `seo/cities.json` (72 kota, 33 provinsi), jadi kota diturunkan dari suffix slug
 * artikel, mis. `smm-panel-termurah-jakarta` -> kota `jakarta` -> DKI Jakarta.
 */
function loadCities() {
  if (!existsSync(CITIES_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CITIES_PATH, 'utf8'));
    const list = Array.isArray(raw.cities) ? raw.cities : Object.values(raw.cities || {});
    const bySlug = new Map();
    for (const c of list) if (c.slug) bySlug.set(c.slug, c);
    return bySlug;
  } catch (e) {
    console.error(`mesh-build: cities.json tidak bisa dibaca — aturan kota tetangga dilewati (${e.message})`);
    return null;
  }
}

/** Kota dari slug artikel: cocokkan city-slug di posisi akhir (paling panjang dulu). */
function detectCity(slug, citiesBySlug) {
  if (!citiesBySlug) return null;
  const sorted = [...citiesBySlug.keys()].sort((a, b) => b.length - a.length);
  for (const cs of sorted) {
    if (slug === cs || slug.endsWith('-' + cs)) return citiesBySlug.get(cs);
  }
  return null;
}

function main() {
  const articles = readArticles();
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  const published = new Set(articles.filter((a) => !a.draft).map((a) => a.slug));
  const manifest = loadManifest();
  const citiesBySlug = loadCities();
  const cityOf = (slug) => detectCity(slug, citiesBySlug);

  const pillarOf = (slug) => (manifest ? manifest.slugToPillar.get(slug) || null : null);
  const metaOf = (slug) => (manifest ? manifest.metaBySlug.get(slug) || null : null);

  const inScopeIds = new Set(articles.filter((a) => (ARGS.slug ? a.slug === ARGS.slug : ARGS.all || !a.draft)).map((a) => a.slug));
  const inScopePublished = (slug) => inScopeIds.has(slug) && published.has(slug);
  const targets = articles.filter((a) => {
    if (ARGS.slug) return a.slug === ARGS.slug;
    return ARGS.all || !a.draft;
  });

  const results = [];
  let changed = 0;

  for (const art of targets) {
    const pillarId = pillarOf(art.slug);
    const meta = metaOf(art.slug);
    const picked = [];
    const why = [];

    // 0. Pertahankan related[] eksisting (kurasi manual) selama targetnya masih
    //    published. Tanpa ini, urutan alfabet sibling bisa menimpa link yang
    //    sengaja dipilih manusia (mis. smm-panel -> smm-panel-indonesia).
    //    Use --reset untuk menghitung ulang dari nol.
    if (!ARGS.reset) {
      for (const old of art.related) {
        if (picked.length >= MAX_RELATED) break;
        if (old === art.slug) continue;
        if (!inScopePublished(old)) continue; // di luar write-set: jangan sentuh
        if (!published.has(old)) {
          why.push(`DROP: ${old} (draft/tidak ada)`);
          continue;
        }
        picked.push(old);
        why.push('dipertahankan (eksisting)');
      }
    }

    // 1. pillar (kalau artikel pilar-nya published)
    const pillarArticleSlug = pillarId && manifest ? manifest.pillarsById.get(pillarId)?.slug : null;
    if (pillarArticleSlug && pillarArticleSlug !== art.slug && published.has(pillarArticleSlug) && !picked.includes(pillarArticleSlug)) {
      picked.push(pillarArticleSlug);
      why.push(`pilar ${pillarId}`);
    }

    // 2. sibling di pilar yang sama, utamakan kategori sama
    const siblings = articles
      .filter((o) => o.slug !== art.slug && published.has(o.slug) && pillarId && pillarOf(o.slug) === pillarId)
      .map((o) => ({
        o,
        score: (art.category && o.category === art.category ? 2 : 0) + 1,
      }))
      .sort((a, b) => b.score - a.score || a.o.slug.localeCompare(b.o.slug));
    for (const { o } of siblings) {
      if (picked.length >= MAX_RELATED) break;
      if (!picked.includes(o.slug)) {
        picked.push(o.slug);
        why.push(`sibling (${o.category || 'tanpa kategori'})`);
      }
    }

    // 3. kota tetangga se-provinsi (khusus artikel geo)
    const myCity = cityOf(art.slug);
    if (myCity && picked.length < MAX_RELATED) {
      const neighbors = articles
        .filter((o) => o.slug !== art.slug && published.has(o.slug))
        .map((o) => ({ o, c: cityOf(o.slug) }))
        .filter((x) => x.c && x.c.provinsi === myCity.provinsi);
      for (const { o, c } of neighbors) {
        if (picked.length >= MAX_RELATED) break;
        if (!picked.includes(o.slug)) {
          picked.push(o.slug);
          why.push(`kota tetangga (${c.city})`);
        }
      }
    }

    // Fallback: kalauPublished masih sedikit, pakai artikel published lain yang belum dipakai
    if (picked.length < MAX_RELATED) {
      for (const o of articles) {
        if (picked.length >= MAX_RELATED) break;
        if (o.slug === art.slug || !published.has(o.slug) || picked.includes(o.slug)) continue;
        picked.push(o.slug);
        why.push('fallback (published)');
      }
    }

    const before = JSON.stringify(art.related);
    const after = JSON.stringify(picked.slice(0, MAX_RELATED));
    const isChanged = before !== after;
    if (isChanged) changed++;

    results.push({
      slug: art.slug,
      file: art.file,
      draft: art.draft,
      pillar: pillarId,
      geo: cityOf(art.slug)?.city || null,
      provinsi: cityOf(art.slug)?.provinsi || null,
      related: picked.slice(0, MAX_RELATED),
      reasons: why,
      dropped: why.filter((w) => w.startsWith('DROP:')).map((w) => w.replace('DROP: ', '').split(' ')[0]),
      changed: isChanged,
      written: false,
      error: null,
    });
  }

  // --- Jaminan link 2-arah -------------------------------------------------
  // Greedy pick di atas bisa asimetris: A memilih B, tapi B lebih suka C.
  // Mesh = dua arah, jadi balik setiap edge yang belum dibalas (selama slot B cukup).
  const byResult = new Map(results.map((r) => [r.slug, r]));
  const inWriteSet = new Set(results.map((r) => r.slug));
  const needsManual = [];
  let reciprocalAdded = 0;
  if (ARGS.reciprocal) {
    for (let pass = 0; pass < 3; pass++) {
      let addedThisPass = 0;
      for (const r of results) {
        for (const target of [...r.related]) {
          const tr = byResult.get(target);
          if (!tr) {
            // target tidak ikut diproses (mis. di luar --write set) -> catat, jangan tulis diam-diam
            if (!inWriteSet.has(target)) needsManual.push(`${r.slug} -> ${target} (target tidak diproses)`);
            continue;
          }
          if (tr.related.includes(r.slug)) continue;
          if (tr.related.length < MAX_RELATED) {
            tr.related.push(r.slug);
            tr.changed = true;
            tr.reasons[tr.related.length - 1] = 'resiprokal';
            addedThisPass++;
            reciprocalAdded++;
          } else {
            needsManual.push(`${r.slug} -> ${target} (slot ${target} penuh)`);
          }
        }
      }
      if (addedThisPass === 0) break;
    }
  }

  // --- TULIS (satu titik, setelah semua aturan selesai) ----------------------
  // Dilakukan di sini, bukan di loop picking, supaya isi file di disk PASTI
  // sama dengan yang dilaporkan (termasuk tambahan resiprokal).
  let writtenCount = 0;
  if (ARGS.write) {
    for (const r of results) {
      if (!r.changed || r.invalid) continue;
      try {
        const src = readFileSync(r.file, 'utf8');
        const next = replaceRelated(src, r.related);
        // verifikasi SEBELUM menimpa: pagar '---' utuh + related[] bisa dibaca ulang
        const fences = (next.match(/^---$/gm) || []).length;
        if (fences !== 2) throw new Error(`pagar '---' berubah (${fences}, harus 2) — tidak ditulis`);
        const recheck = parseRelated(next.slice(0, next.indexOf(NL + '---', 3)));
        if (JSON.stringify(recheck) !== JSON.stringify(r.related)) {
          throw new Error(`hasil tulis tidak cocok: ${JSON.stringify(recheck)} != ${JSON.stringify(r.related)}`);
        }
        writeFileSync(r.file, next);
        r.written = true;
        writtenCount++;
      } catch (e) {
        r.error = e.message;
      }
    }
  }

  // Guard struktural frontmatter: file WAJIB punya tepat 2 baris '---'
  // (pembuka + penutup). Kalau tidak, file rusak dan harus ditolak.
  for (const a of articles) {
    const src = readFileSync(a.file, 'utf8');
    const fences = (src.match(/^---$/gm) || []).length;
    if (fences !== 2) {
      console.error(`\n  ⛔ frontmatter rusak (${fences} pagar '---', harus 2): ${a.slug}`);
      process.exitCode = 3;
      return;
    }
  }

  // Guard terakhir: apoptosis dedup setelah semua aturan (pillar/sibling/
  // tetangga/fallback/resiprokal). Kalau ada slug yang dobel, tandai error —
  // related[] dobel akan render link kembar di template.
  const dupes = results.filter((r) => new Set(r.related).size !== r.related.length);
  for (const r of dupes) {
    r.error = `duplikat di related[]: ${r.related.join(', ')}`;
    r.invalid = true;
  }

  // Statistik & masalah
  const publishedResults = results.filter((r) => !r.draft);
  const orphanMesh = publishedResults.filter((r) => r.related.length === 0);
  const noPillar = publishedResults.filter((r) => !r.pillar);

  const summary = {
    mode: ARGS.write ? 'write' : 'report',
    scope: ARGS.slug ? 'single' : ARGS.all ? 'all' : 'published',
    articles_total: articles.length,
    published_total: published.size,
    processed: results.length,
    changed: results.filter((r) => r.changed).length,
    invalid: dupes.map((r) => r.slug),
    written: writtenCount,
    reciprocal_added: reciprocalAdded,
    needs_manual_backlink: [...new Set(needsManual)],
    orphans: orphanMesh.map((r) => r.slug),
    published_without_pillar: noPillar.map((r) => r.slug),
    results,
  };

  if (ARGS.json) {
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 0;
    return;
  }

  console.log(`mesh-build — ${ARGS.write ? 'WRITE' : 'LAPORAN'} · ${summary.processed} artikel (${summary.scope}) · korpus ${articles.length} (${published.size} published)`);
  if (manifest) console.log('  peta pilar: dari seo/clusters.json');
  else console.log('  ⚠ clusters.json tidak ada — mesh tanpa peta pilar (hanya sibling by published)');
  console.log('');

  for (const r of results) {
    const tag = r.changed ? (ARGS.write ? 'DIUBAH' : 'would change') : 'sama';
    console.log(`  [${tag}] ${r.slug}${r.geo ? ` (geo ${r.geo} · ${r.provinsi})` : ''}`);
    if (r.related.length) {
      r.related.forEach((s, i) => console.log(`        ${i + 1}. /blog/${s}   — ${r.reasons[i]}`));
    } else {
      console.log('        (tidak ada target published untuk dilink)');
    }
    if (r.dropped?.length) console.log(`        drop (target draft): ${r.dropped.join(', ')}`);
    if (r.written) console.log(`        → ditulis ke frontmatter`);
    if (r.error) console.log(`        ERROR tulis: ${r.error}`);
  }

  if (dupes.length) {
    console.log(`\n  ⛔ ${dupes.length} artikel punya duplikat di related[] — TIDAK ditulis. Perbaiki.Aturan picking.`);
  }
  console.log(`\n  ringkasan: ${changed} artikel akan berubah · ${orphanMesh.length} tanpa mesh · ${noPillar.length} published tanpa pilar · resiprokal +${reciprocalAdded} edge`);
  if (orphanMesh.length) console.log(`    tanpa mesh: ${orphanMesh.map((r) => r.slug).join(', ')}`);
  if (noPillar.length) console.log(`    tanpa pilar (tidak ada di clusters.json): ${noPillar.map((r) => r.slug).join(', ')}`);

  // Exit code untuk gate publish: 4 = related[] bermasalah (duplikat).
  if (dupes.length) process.exitCode = 4;

  if (!ARGS.write && changed) {
    console.log('\n  (mode laporan — jalankan dengan --write untuk menerapkan)');
  } else if (ARGS.write) {
    console.log(`\n  ${writtenCount} frontmatter related[] ditulis (resiprokal: +${reciprocalAdded} edge).`);
  }
}

try {
  main();
} catch (e) {
  console.error('mesh-build FATAL:', e.message);
  process.exitCode = 2;
}
