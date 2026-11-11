#!/usr/bin/env python3
"""Fase 10b — sapu sisa vocabulary socio.id + path landing/ di mesin yang diport.

Setiap edit dinyatakan sebagai (berkas, penanda_baris_unik, teks_pengganti).
Script berhenti dengan exit 1 kalau penanda tidak ketemu PAS SATU kali, jadi
tidak ada penggantian diam-diam yang lolos. Baris diganti utuh (bukan substring)
supaya regex dengan backslash tidak perlu ditulis ulang di sini.
"""
import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[1])

# (file, marker, [lines pengganti])  — marker harus cocok tepat satu baris
LINE_EDITS = [
    # ---- article-lint: parser YAML dari tree site, bukan workspace landing ----
    ('seo/lib/article-lint.mjs', '// js-yaml hanya terpasang di workspace `landing`',
     ["// Paket YAML yang ada di repo ini `yaml` (ikutan Astro), bukan `js-yaml`."]),
    ('seo/lib/article-lint.mjs', "join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'landing', 'noop.js'),",
     ["  // Resolve dari site/: di container runner yang tidak punya node_modules,",
      "  // yamlTersedia() balas false dan pemanggil yang memutuskan fatal atau tidak.",
      "  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'noop.js'),"]),
    ('seo/lib/article-lint.mjs', "const requireLanding = createRequire(",
     ["const requireSite = createRequire("]),
    ('seo/lib/article-lint.mjs', "  YAML = requireLanding('js-yaml');",
     ["  // Dua kandidat, satu baris: js-yaml kalau ada, kalau tidak `yaml` milik Astro.",
      "  // Kalau dua-duanya gagal, outer catch yang menelan - perilaku lama tidak berubah.",
      "  try { YAML = requireSite('js-yaml'); } catch { const y = requireSite('yaml'); YAML = { load: (s) => y.parse(s) }; }"]),
    ('seo/lib/article-lint.mjs', "  'instagram', 'tiktok', 'telegram', 'youtube', 'twitter', 'facebook', 'spotify', 'smm', 'faq',",
     ["  'padalarang', 'cimahi', 'laksanamekar', 'podomoro', 'summarecon', 'soreang',",
      "  'bandungraya', 'kcic', 'unjani', 'dustira', 'baros', 'cililin', 'batuasok',",
      "  'bphtb', 'shm', 'shgb', 'hgb', 'ppjb', 'pbg', 'imb', 'slbi', 'ipl', 'nup',",
      "  'kpr', 'faq', 'simulasi', 'whatsapp', 'instagram', 'tiktok', 'youtube',"]),

    # ---- mesh-build: skema kami pakai tags[], bukan category: ----
    ('seo/mesh-build.mjs', "      category: (fm.match(/^category:",
     ["      category: fmTags(fm),"]),
    ('seo/mesh-build.mjs', "/** related lama dari frontmatter (YAML list). */",
     ["/**",
      " * Kategori untuk skoring sibling. Collection ini tidak punya field",
      " * `category:` — yang ada `tags: [\"kpr\"]` — dan tag pertama adalah topik",
      " * utama yang ditulis generator (deriveMeta -> mapTags), jadi itu yang",
      " * dipakai sebagai kelompok. Tidak ada tag = '' (tidak pernah menang bonus).",
      " */",
      "function fmTags(fm) {",
      "  const m = fm.match(/^tags:[ \\t]*\\[([^\\]]*)\\]/m);",
      "  if (!m) return '';",
      "  return m[1]",
      "    .split(',')",
      "    .map((s) => s.trim().replace(/^[\"']|[\"']$/g, ''))",
      "    .filter(Boolean)",
      "    .join(' ');",
      "}",
      "",
      "/** related lama dari frontmatter (YAML list). */"]),

    # ---- qc-uniqueness: sama, category -> tags ----
    ('seo/qc-uniqueness.mjs', "    category: get('category'),",
     ["    category: fmTags(fm),"]),
    ('seo/qc-uniqueness.mjs', "/** Ambil field frontmatter sederhana (title/draft/cluster/category). */",
     ["/** tags: [\"kpr\", \"lokasi\"] -> 'kpr lokasi' (kelompok untuk skoring). */",
      "function fmTags(fm) {",
      "  const m = fm.match(/^tags:[ \\t]*\\[([^\\]]*)\\]/m);",
      "  if (!m) return '';",
      "  return m[1]",
      "    .split(',')",
      "    .map((s) => s.trim().replace(/^[\"']|[\"']$/g, ''))",
      "    .filter(Boolean)",
      "    .join(' ');",
      "}",
      "",
      "/** Ambil field frontmatter sederhana (title/draft/cluster/category). */"]),

    # ---- llms.mjs: jalan di repo ini, bukan di workspace socio ----
    ('seo/llms.mjs', "import yaml from 'js-yaml';",
     ["import { createRequire } from 'node:module';",
      "",
      "// Dual resolver seperti lib/article-lint: `js-yaml` kalau ada, kalau tidak",
      "// `yaml` milik Astro. Import langsung 'js-yaml' akan membuat script ini",
      "// crash sebelum sempat memutuskan apa pun.",
      "const requireSite = createRequire(join(ROOT, 'site', 'noop.js'));",
      "let yaml = null;",
      "try {",
      "  yaml = requireSite('js-yaml');",
      "} catch {",
      "  try {",
      "    const y = requireSite('yaml');",
      "    yaml = { load: (s) => y.parse(s) };",
      "  } catch {",
      "    yaml = null;",
      "  }",
      "}"]),
    ('seo/llms.mjs', "const SITE = 'https://valleycity.id';",
     ["import { SITE, BRAND } from './site.mjs';"]),
    ('seo/llms.mjs', "    fm = yaml.load(fmText) || {};",
     ["    fm = yaml ? yaml.load(fmText) || {} : null;",
      "    if (!fm) return null; // tidak ada parser YAML -> skip, jangan karang"]),
    ('seo/llms.mjs', "  return { fm, body: strippedBody };",
     ["  return { fm, body: strippedBody, bodyRaw: body };"]),
    ('seo/llms.mjs', "    if (!parsed || parsed.fm.draft) continue; // skip draft",
     ["    if (!parsed || parsed.fm.status === 'draft') continue; // draft tidak dirender"]),
    ('seo/llms.mjs', "      category: parsed.fm.category || 'Lainnya',",
     ["      category: (parsed.fm.tags || []).join(', ') || 'panduan',"]),
    ('seo/llms.mjs', "      faq: Array.isArray(parsed.fm.faq) ? parsed.fm.faq : [],",
     ["      // FAQ di collection ini ada di BODY (## FAQ + pasangan **tanya**/jawab),",
      "      // bukan di frontmatter. Mengambil dari fm.faq = selalu kosong.",
      "      faq: faqFromBody(parsed.bodyRaw),"]),

    # ---- keyword-suggest: blog-expand tidak diport ----
    ('seo/keyword-suggest.mjs', "  console.log(`[suggest]   node seo/blog-expand.mjs --count=${added}`);",
     ["  console.log('[suggest] setelah daftar disetujui di keywords.json: node seo/seed-queue.mjs');"]),

    # ---- publish/publish-git: build & validasi ----
    ('seo/publish.mjs', "  console.log('\\n=== build landing ===');",
     ["  console.log('\\n=== build site (Astro) ===');"]),
    ('seo/publish.mjs', "  run('pnpm --filter landing build');",
     ["  run('npm --prefix site run build');"]),
    ('seo/jsonld-validate.mjs', "pnpm --filter landing build`);",
     ["    console.error(`jsonld-validate: direktori tidak ada: ${dist}${NL}  \u2192 build dulu: npm --prefix site run build`);"]),
    ('seo/publish-git.mjs', "      runNode('jsonld-live.mjs', publishedUrls);",
     ["      runNode('jsonld-validate.mjs', ['--strict']);"]),
    ('seo/publish-git.mjs', "    console.log('\\n=== jsonld-live ===');",
     ["    console.log('\\n=== jsonld-validate --strict (dist lokal) ===');"]),
    ('seo/publish-git.mjs', "      console.log('  \u26a0 jsonld-live memberi peringatan (lihat di atas) \u2014 lanjut, sudah tayang.');",
     ["      console.log('  \u26a0 jsonld-validate memberi peringatan (lihat di atas) \u2014 lanjut, sudah tayang; perbaiki di commit berikutnya.');"]),

    # ---- bootstrap-state: domain dari satu sumber ----
    ('seo/bootstrap-state.mjs', "const SITE = 'https://valleycity.id';",
     ["import { SITE } from './site.mjs';"]),

    # ---- prompts.ts: default tag ----
    ('seo/prompts.ts', "  const c = String(category || 'umkm').toLowerCase();",
     ["  const c = String(category || 'panduan').toLowerCase();"]),

    # ---- runner/idle: nama proyek + typo ----
    ('runner/idle.mjs', "balapan. Scheduled Task di Coolify menjalankan command **di dalam** container",
     ["dan saling balapan. Scheduled Task di Coolify menjalankan command **di dalam** container"]),
    ('runner/idle.mjs', " * `docs/COOLIFY_SEO_PROJECT.md` \u00a77.",
     [" * `runner/README.md` (Scheduled Task)."]),
    ('runner/idle.mjs', "console.log(`[idle] socio-seo-runner siap",
     ["console.log(`[idle] valleycity-seo-runner siap"]),

    # ---- generate.mjs: kutub harga default + catatan money page ----
    ('seo/generate.mjs', '/* Satu produk, jadi tidak ada "pool harga" seperti katalog SMM: yang dikirim',
     ['/* Satu produk, jadi tidak ada "pool harga" seperti katalog layanan: yang dikirim']),
]

LITERAL_SWEEPS = [
    ('SOCIO_INDEXNOW_KEY', 'INDEXNOW_KEY'),
    ('socio-seo-runner', 'valleycity-seo-runner'),
    ('docs/GOOGLE_CLOUD_SETUP.md', 'seo/README.md'),
    ('docs/COOLIFY_SEO_PROJECT.md', 'runner/README.md'),
    ('di socio.id', 'di proyek sebelumnya'),
]

TARGETS = [
    'seo/generate.mjs', 'seo/publish.mjs', 'seo/publish-git.mjs', 'seo/indexnow.mjs',
    'seo/indexer.mjs', 'seo/remedy.mjs', 'seo/llms.mjs', 'seo/mesh-build.mjs',
    'seo/qc-uniqueness.mjs', 'seo/qc.mjs', 'seo/keyword-suggest.mjs', 'seo/bootstrap-state.mjs',
    'seo/jsonld-validate.mjs', 'seo/heal-queue.mjs', 'seo/gsc-inspect.mjs', 'seo/bing-submit.mjs',
    'seo/ramp-gate.mjs', 'seo/prompts.ts', 'seo/lib/article-lint.mjs', 'seo/lib/gsc.mjs',
    'seo/scripts/gsc-doctor.mjs', 'runner/daily.mjs', 'runner/weekly.mjs', 'runner/idle.mjs',
    'runner/lib/notify.mjs', 'runner/lib/lock.mjs',
]

fail = []
cache = {}


def load(p):
    if p not in cache:
        cache[p] = open(f'{ROOT}/{p}', encoding='utf-8').read()
    return cache[p]


def save(p):
    open(f'{ROOT}/{p}', 'w', encoding='utf-8').write(cache[p])


for path, marker, repl in LINE_EDITS:
    src = load(path)
    lines = src.split('\n')
    hits = [i for i, l in enumerate(lines) if marker in l]
    if len(hits) != 1:
        fail.append(f'{path}: penanda {marker!r} cocok {len(hits)}x (harus 1)')
        continue
    i = hits[0]
    lines[i:i + 1] = repl
    cache[path] = '\n'.join(lines)

for path in TARGETS:
    src = load(path)
    for old, new in LITERAL_SWEEPS:
        src = src.replace(old, new)
    cache[path] = src

if fail:
    print('GAGAL:')
    for f in fail:
        print('  - ' + f)
    sys.exit(1)

for p in sorted(cache):
    save(p)
print(f'ok: {len(LINE_EDITS)} edit baris + {len(LITERAL_SWEEPS)} sweep literal di {len(set(cache))} berkas')
