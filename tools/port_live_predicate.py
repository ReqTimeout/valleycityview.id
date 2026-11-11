#!/usr/bin/env python3
"""Fase 10b — mesin pakai satu definisi "tayang" (seo/lib/live-posts.mjs).

Sebelumnya tiap script menyimpulkan sendiri dari `!draft`, dan `!draft` di repo
ini termasuk 17 post redirect. Akibatnya konkret: mesh-build akan menaruh
related → /blog/cicilan-rumah-bandung-miliki-.../ yang ternyata 301, dan
qc-uniqueness menandai duplikat terhadap stub yang kontennya tidak pernah
disajikan. Setiap edit di bawah menyatakan penanda yang harus cocok — tidak ada
penggantian diam-diam.
"""
import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[1])
EDITS = []


def edit(path, old, new):
    EDITS.append((path, old, new))


# ============ mesh-build ============
edit('seo/mesh-build.mjs',
     "import { BLOG_DIR, ROOT } from './paths.mjs';",
     "import { BLOG_DIR, ROOT } from './paths.mjs';\nimport { isLive } from './lib/live-posts.mjs';")

edit('seo/mesh-build.mjs',
     "      draft: /^status:[ \\t]*draft/m.test(fm),",
     "      draft: /^status:[ \\t]*draft/m.test(fm),\n      live: isLive(fm),\n      redirect: /^redirectTo:/m.test(fm),")

edit('seo/mesh-build.mjs',
     "  const published = new Set(articles.filter((a) => !a.draft).map((a) => a.slug));",
     "  // Target link harus tayang, bukan sekadar bukan draft: stub redirect lolos uji\n"
     "  // !draft tapi URL-nya menjawab 301.\n"
     "  const published = new Set(articles.filter((a) => a.live).map((a) => a.slug));")

edit('seo/mesh-build.mjs',
     "  const inScopeIds = new Set(articles.filter((a) => (ARGS.slug ? a.slug === ARGS.slug : ARGS.all || !a.draft)).map((a) => a.slug));",
     "  const inScopeIds = new Set(articles.filter((a) => (ARGS.slug ? a.slug === ARGS.slug : (ARGS.all ? !a.redirect : a.live))).map((a) => a.slug));")

edit('seo/mesh-build.mjs',
     "    return ARGS.all || !a.draft;",
     "    return ARGS.all ? !a.redirect : a.live;")

edit('seo/mesh-build.mjs',
     "      draft: art.draft,",
     "      draft: art.draft,\n      live: art.live,")

edit('seo/mesh-build.mjs',
     "  const publishedResults = results.filter((r) => !r.draft);",
     "  const publishedResults = results.filter((r) => r.live);")

edit('seo/mesh-build.mjs',
     "  console.log('  --all       ikut memproses draft (default: published saja)');",
     "  console.log('  --all       ikut memproses draft (stub redirect tidak pernah, karena isinya tidak tayang)');")

# ============ qc.mjs ============
edit('seo/qc.mjs',
     "import { BLOG_DIR, QUEUE_PATH } from './paths.mjs';",
     "import { BLOG_DIR, QUEUE_PATH } from './paths.mjs';\nimport { liveSlugs } from './lib/live-posts.mjs';")

edit('seo/qc.mjs',
     "const publishedSlugs = allMdx.filter((s) => !readFileSync(join(BLOG_DIR, `${s}.md`), 'utf8').includes(DRAFT_FLAG));",
     "// liveSlugs() = predikat route Astro (publish + bukan redirect). Draft dan stub\n"
     "// redirect keluar dari daftar, supaya target link yang diperiksa QC benar-benar 200.\n"
     "const publishedSlugs = liveSlugs();")

# ============ qc-uniqueness ============
edit('seo/qc-uniqueness.mjs',
     "import { hasGeoAnchor, anchorProbe } from './lib/geo-anchor.mjs';",
     "import { hasGeoAnchor, anchorProbe } from './lib/geo-anchor.mjs';\nimport { isLive } from './lib/live-posts.mjs';")

edit('seo/qc-uniqueness.mjs',
     "  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md'));",
     "  // Corpus = konten yang tayang. Draft dan stub redirect dihapus sebelum masuk:\n"
     "  // stub menyimpan body lengkap, jadi kalau ikut dinilai dia menciptakan\n"
     "  // kemiripan tinggi terhadap artikel yang isinya justru tidak disajikan.\n"
     "  const files = readdirSync(BLOG_DIR)\n"
     "    .filter((f) => f.endsWith('.md'))\n"
     "    .filter((f) => isLive(readFileSync(join(BLOG_DIR, f), 'utf8')));")

# ============ llms.mjs ============
edit('seo/llms.mjs',
     "import { ROOT, BLOG_DIR, PUBLIC_DIR, SITEMAP_PATH } from './paths.mjs';",
     "import { ROOT, BLOG_DIR, PUBLIC_DIR, SITEMAP_PATH } from './paths.mjs';\nimport { isLive } from './lib/live-posts.mjs';")

edit('seo/llms.mjs',
     "    if (!parsed || parsed.fm.status === 'draft') continue; // draft tidak dirender\n"
     "    // redirectTo = post 301 hasil audit Fase 10. Routenya ada, kontennya tidak;\n"
     "    // memasukkannya ke llms.txt berarti mengirim AI ke halaman yang jawabannya\n"
     "    // \"pindah ke URL lain\", dan jumlah artikel tidak akan cocok dengan sitemap.\n"
     "    if (parsed.fm.redirectTo) continue;",
     "    // Predikat tayang satu sumber dengan route Astro + mesh-build (lihat lib/live).\n"
     "    if (!parsed || !isLive(parsed.fm)) continue;")

# ============ seed-queue.mjs ============
edit('seo/seed-queue.mjs',
     "} from './paths.mjs';",
     "} from './paths.mjs';\nimport { isLive } from './lib/live-posts.mjs';")

edit('seo/seed-queue.mjs',
     "  return /^status:\\s*publish\\s*$/m.test(raw) && !/^redirectTo:/m.test(raw);",
     "  return isLive(raw);")

# ============ generate.mjs ============
edit('seo/generate.mjs',
     "import { injectGeoAnchor } from './lib/geo-anchor.mjs';",
     "import { injectGeoAnchor } from './lib/geo-anchor.mjs';\nimport { liveSlugs } from './lib/live-posts.mjs';")

edit('seo/generate.mjs',
     "// publishedSlugs: hanya artikel yang ada di disk + sudah publish yang boleh jadi tautan\n"
     "// internal \"Baca juga\". Draft (status: draft) belum tampil di situs = 404 kalau di-link.\n"
     "function publishedSlugs() {\n"
     "  if (!existsSync(BLOG_DIR)) return [];\n"
     "  return readdirSync(BLOG_DIR)\n"
     "    .filter((f) => f.endsWith('.md'))\n"
     "    .map((f) => ({ slug: f.replace(/\\.md$/, ''), path: join(BLOG_DIR, f) }))\n"
     "    .filter((r) => !readFileSync(r.path, 'utf8').includes('\\nstatus: draft'))\n"
     "    .map((r) => r.slug);\n"
     "}",
     "// publishedSlugs: artikel yang benar-benar tayang — liveSlugs() memakai predikat\n"
     "// yang sama dengan route Astro. Draft belum tampil = 404 kalau di-link, dan stub\n"
     "// redirect hasil audit Fase 10 tampil sebagai 301: dua-duanya bukan target link.\n"
     "function publishedSlugs() {\n"
     "  return liveSlugs();\n"
     "}")

# ================= eksekusi =================
cache = {}


def load(p):
    if p not in cache:
        cache[p] = open(f'{ROOT}/{p}', encoding='utf-8').read()
    return cache[p]


fail = []
for path, old, new in EDITS:
    src = load(path)
    n = src.count(old)
    if n != 1:
        fail.append(f'{path}: penanda cocok {n}x -> {old[:70]!r}')
        continue
    cache[path] = src.replace(old, new, 1)

if fail:
    print('GAGAL:')
    for f in fail:
        print('  - ' + f)
    sys.exit(1)

for p, s in cache.items():
    open(f'{ROOT}/{p}', 'w', encoding='utf-8').write(s)
print(f'ok: {len(EDITS)} edit di {len(cache)} berkas')
