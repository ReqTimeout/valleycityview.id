# seo/ — mesin artikel valleycity.id

Port dari `ssoe-runner` (proyek socio.id). Yang dipertahankan: seluruh gerbang dan
alur penerbitan. Yang dibuang: Worker, database, dan matriks keyword × kota —
situs ini punya satu produk di satu lokasi, jadi state-nya cukup berkas JSON di
git dan variasi geografisnya cukup lima area di `cities.json`.

## Prinsip yang tidak boleh balik

1. **Tidak ada Worker, tidak ada DB.** `queue.json`, `config.json`, `state.json`
   adalah kebenaran; semuanya ada di repo dan runner menulisnya lewat commit.
2. **Gerbang gagal tertutup (fail-closed).** Artikel tidak boleh berpindah dari
   draft ke terbit kalau salah satu dari `article-lint`, `qc-uniqueness`,
   `jsonld-validate --strict` masih merah. Tidak ada `--force` untuk ini.
3. **Tidak ada angka yang dikarang.** Harga/tenor/luas dibaca dari
   `site/src/data/site.ts` lewat `site.mjs`. `fix-sitemap.mjs` menolak menulis
   `<lastmod>` untuk halaman yang tidak punya peristiwa perubahan terukur.
4. **Satu definisi "tayang".** `lib/live-posts.mjs` memakai predikat yang sama
   dengan route Astro (`status: publish` dan bukan `redirectTo`). Siapa pun yang
   menyimpulkan sendiri akan menautkan artikel ke URL 301 (17 post hasil audit
   Fase 10 persis kasus itu).

## Berkas state

| berkas | isi | siapa menulis |
|---|---|---|
| `keywords.json` | daftar kata kunci + `_meta.approved_at` | manusia; generator menolak jalan sebelum ini disetujui |
| `cities.json` | 5 area anchor (Padalarang, Cimahi, Bandung Barat, Laksanamekar, Baros) | manusia |
| `queue.json` | antrean kerja: 54 post impor + keyword approved | `seed-queue.mjs` |
| `config.json` | `daily_count` (mulai 1), ambang ramp, halt | `ramp-gate.mjs` |
| `state.json` | URL terbit + status inspeksi GSC + indexnow | `bootstrap-state.mjs`, lalu pipeline |
| `state.seed.json` | seed kosong untuk container | manusia (jangan dipakai sebagai dasar ukur) |
| `audit/posts.json` | keputusan audit 71 post (17 redirect / 54 tetap) | `site/scripts/audit-posts.mjs` |

## Alur harian

```
node seo/ramp-gate.mjs            # tetapkan daily_count dari data GSC, bukan dari nafsu
node seo/seed-queue.mjs           # isi antrean dari disk + keyword yang disetujui
node seo/generate.mjs --count=1   # gera draft (gerbang keyword menutup kalau belum OK)
node seo/check-article.mjs <slug> # lint + uniqueness untuk satu draft
node seo/mesh-build.mjs --write   # related 3 arah, target hanya yang tayang
node seo/publish.mjs --count=1    # flip publish → build → validasi → git push → tunggu Pages
node seo/indexnow.mjs             # submit URL baru (Bing/Yandex; Google tetap lewat sitemap)
node seo/heal-queue.mjs           # sinkronkan queue.json dengan isi disk
```

`llms.mjs` dan `fix-sitemap.mjs` berjalan otomatis dari `npm --prefix site run build`.

## Gerbang dan artinya hari ini

- **Gerbang keyword: TERTUTUP.** `keywords.json` berisi 31 kurasi manusia tapi
  `_meta.approved_at` masih `null`. Ini keputusan, bukan kelalaian: persetujuan
  generator tidak bisa diberikan oleh generator. Setel `approved_at` +
  `approved_by` hanya kalau Anda memang menyetujui daftar itu, lalu jalankan
  `node seo/seed-queue.mjs`.
- **`jsonld-validate --strict`: HIJAU** (0 warning) sejak `Seo.astro` mengirim
  WebPage + BreadcrumbList untuk semua halaman indexable.
- **`ramp-gate`: HOLD di 1 artikel/hari.** `discovered = 0 < min_sample 5`,
  sebabnya belum ada pengukuran GSC sama sekali — bukan kegagalan discovery.
  Naikkan hanya lewat data, atau `--set` dengan alasan yang Anda tulis sendiri.
- **Belum tersambung:** kredensial GSC (`GSC_SERVICE_ACCOUNT_JSON`), token
  GitHub untuk push (`GITHUB_TOKEN`), Cloudflare API untuk menunggu deploy
  (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`), kunci Groq
  (`GROQ_API_KEY`), dan report email (`RESEND_API_KEY`).

## §3 IndexNow

Key disimpan di `site/public/indexnow.txt` (32 hex, acak, dibuat lokal) dan ikut
ter-serve di `https://valleycity.id/indexnow.txt` — itu mekanisme auto-discover
resminya, jadi memang publik. Override lewat `INDEXNOW_KEY` (nilai) atau
`INDEXNOW_KEY_FILE` (lokasi lain, dipakai container yang menaruh data di volume).

## Env override

`SEO_STATE_PATH` · `SEO_CONFIG_PATH` · `SEO_QUEUE_PATH` · `SEO_CONTENT_DIR` ·
`SEO_KEYWORDS_PATH` · `SEO_MIN_KEYWORDS` · `SEO_MINED_PATH` ·
`SEO_SKIP_INDEXER|GENERATE|PUBLISH=1` · `CF_PAGES_PROJECT` · `GSC_SITE_URL` ·
`NOTIFY_PREFIX` · `NOTIFY_EMAIL_TO|FROM` · `SEO_NOTIFY_DRYRUN=1`

## Yang sengaja tidak diport

- **`clusters.json`** (pillar/claster). Mesh berjalan tanpa pilar: skoring sibling
  tetap jalan, hanya label "pillar" kosong. Mengarang pilar = membuat klaim
  struktur konten yang belum kita putuskan.
- **`geo-expand.mjs`** dan matriks `keywords.geo.json` (980 KB) — tidak ada
  padanannya untuk satu lokasi.
- **`blog-expand.mjs`** — diganti `seed-queue.mjs` yang sumbernya disk + keywords.
- **Worker/Cron runtime** — `runner/` dan Scheduled Task.

## Catatan port yang masih terbuka

- `keyword-suggest.mjs` adalah alat riset manual. Kosakata seed-nya sudah
  properti, tapi `--push` sekarang menulis kandidat ke `keywords.json` dengan
  `approved: false` — bukan langsung ke antrean.
- Audit kontras (`site/scripts/audit-contrast.mjs`) masih MERAH di 4 frame
  `/nup/`, `/sale/`, `/agent/`, `/agent/alt/` (viewport pertama desktop, teks di
  atas foto). Tidak ada hubungannya dengan mesin ini; itu pekerjaan desain yang
  belum selesai, dan tidak boleh ditutup dengan menaikkan ambang.
