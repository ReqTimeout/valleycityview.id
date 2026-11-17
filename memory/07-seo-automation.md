# 07 — SEO Automation System (runbook untuk agent lain / duplikat)

> Ditulis 17 Nov 2026. Ini dokumen **sistem berjalan** (bukan fase rebuild Nov 11).
> Baca ini sebelum menyentuh pipeline publish/indexer/dashboard. Fakta di sini
> diverifikasi lewat tool sesi 17 Nov 2026. Angka bisa berubah — cek runtime dulu.

## 1. Arsitektur (3 bagian, JANGAN tertukar)

| Bagian | Teknologi | Hosting | Fungsi |
|---|---|---|---|
| **Situs publik** `valleycityview.id` | Astro static (`site/`) | Cloudflare Pages proyek `valleycity` = **DIRECT UPLOAD** (tanpa integrasi git) | halaman + blog yang dilihat publik/Google |
| **Runner / mesin SEO** | Node 22 (`seo/*.mjs`, `runner/*.mjs`) | Coolify app uuid `xkyc6wt6lh5avl5tvtghortw` di VPS `167.114.184.98` | generate, publish, deploy Pages, indexer, laporan email, cron |
| **Dashboard** `valleycity.beriklan.co.id` | Svelte 5 SPA (`web/src`) di-serve `runner/lib/http.mjs` | Coolify (container sama dengan runner) | UI pantau/kontrol; login allow-list email |

**Kritis:** push git ke `main` TIDAK men-deploy situs. Situs live hanya berubah
lewat `deployPages()` (build astro + wrangler direct upload). Dashboard berubah
lewat deploy Coolify (build SPA → commit `runner/assets` → deploy app).

## 2. Path runtime — SUMBER KEBENARAN di volume, bukan repo

Container aktif: nama berubah tiap deploy, ambil:
`sudo docker ps --format '{{.Names}}' | grep '^xkyc6wt6lh5avl5tvtghortw-'`
(disimpan sementara di `/tmp/vcv-c.txt` sesi ini).

| Data | Path BENAR (volume `/app/data`) | Path repo BASI (jangan dipakai) |
|---|---|---|
| state | `/app/data/state.json` | `seo/state.json` |
| queue | `/app/data/queue.json` | `seo/queue.json` (mirror commit saja) |
| runs | `/app/data/runs.json` | `seo/runs.json` |
| config | `/app/data/config.json` (`daily_count`) | `seo/config.json` (default basi) |
| blog md | `/app/site/src/collections/blog/*.md` | — |
| keywords | `/app/seo/keywords.json` (694 item: keyword,slug,priority,…) | — |

`data/` di-gitignore. Transfer file aman: `scp` ke host `/tmp` → `sudo docker cp`
ke `/tmp` container → `docker exec cp` ke `/app/…`. JANGAN `docker cp /dev/stdin`.

## 3. Rantai publish → index (TERVERIFIKASI 17 Nov)

`seo/publish-git.mjs` main():
1. pickDrafts (status draft, file ada, lolos gate) urut **priority desc, notes asc**.
2. `flipDraft`: status draft→publish, **date = hari ini WIB**, set `updated`.
3. mesh-build + `llms.mjs` (regen llms.txt + llms-full.txt).
4. commit + push (pull `--rebase --autostash` + retry push bila remote bergerak).
5. `deployPages()` = build site (`redirects && llms.mjs && astro build && fix-sitemap.mjs`) + wrangler upload.
6. `verifyUrls` (live 200).
7. catat `state.published` (langkah 8b) — tanpa ini artikel tak masuk radar GSC/Bing/ramp.
8. jsonld-validate (warn-only).
9. **IndexNow** (`indexnow.mjs`): ping artikel baru **+ WAJIB tiap run** `sitemap-index.xml`, `sitemap-0.xml`, `llms.txt`, `llms-full.txt` (batch ≤10/call, endpoint api.indexnow.org → yandex).
10. **GSC submit sitemap LANGSUNG** (`lib/gsc.mjs submitSitemap`, step 11) — tak tunggu remedy harian.

Harian 06:00 WIB `runner/daily.mjs` → `seo/indexer.mjs` stages: indexnow, bing-submit
(100 URL/hari), gsc-inspect (2000/hari), remedy (re-ping + submit sitemap cooldown 24h),
ramp-gate (Senin: set daily_count dari index_rate). Weekly Senin freshness 2 artikel.

## 4. BUG KRITIS yang sudah diperbaiki (jangan kambuh)

**Tanggal publish stuck → /blog/ tidak update (17 Nov):**
- Penyebab: frontmatter artikel matriks `date: "2026-11-15"` **dikutip**; regex
  flipDraft lama `^date:\s*\d{4}-\d{2}-\d{2}` tidak match kutip → date tidak naik.
- Fix: regex `^date:\s*"?\d{4}-\d{2}-\d{2}"?\s*$` + set `updated`.
- Blog index `[...page].astro` sort **`(updated||date)` desc**, tampilan tanggal &
  `dateModified` JSON-LD ikut `updated||date` (helper `effDate`).
- Backfill 8 artikel matriks lama: date=updated=publishedAt.
- **Pelajaran:** artikel matriks pakai frontmatter dikutip; artikel original (migrasi
  WP, punya `legacyUrl`/`wpId`) date tanpa kutip. Regex harus handle keduanya.

**Git divergence (tick gagal `Not possible to fast-forward`):** container ahead/behind
→ semua pull pakai `--rebase --autostash`, push retry. Jangan `--ff-only`.

**state.published gap (59 tayang, state 54):** publish-git 8b + indexer rekonsiliasi
live posts→state tiap run (non-dry-run).

**Spam email alert:** watchdog hanya email masalah PERSISTEN (rampGate.alert,
remedyAlert, access!=enforced, credentials hilang); `uncatalogued`+`thin` tampil di
halaman tapi TIDAK email. Hash = sha1(codes.sort().join('|')).slice(0,16), cooldown 6 jam.

## 5. Deploy

**Dashboard/runner (Coolify):** API `http://167.114.184.98:8000/api/v1`.
- Mint token: `sudo docker exec coolify php artisan tinker --execute="…PersonalAccessToken::forceFill([token=>hash('sha256',$plain), abilities=>[read,write,delete,deploy], team_id=>0, tokenable_id=>0, expires_at=>now()->addHours(1)])->save()"`. Container app = `coolify` (BUKAN `coolify-proxy-error-pages`).
- Deploy = `POST /api/v1/deploy` body `{"uuid":"xkyc6wt6lh5avl5tvtghortw"}` → `deployments[0].deployment_uuid`. (`POST /applications/{uuid}/deploy` = 404.)
- Poll `GET /api/v1/deployments/{uuid}` → `status` in_progress→finished (~2 menit).
- **Cabut token setelah selesai** (delete by id).
- Env: `POST /applications/{uuid}/envs` SELALU bikin duplikat → GET lalu DELETE dup via `.../envs/{env_uuid}` (field `uuid`, GET sembunyikan `value`; cek nilai via `docker exec env`).

**Situs (CF Pages):** dari container `node -e "import('/app/seo/publish-git.mjs').then(m=>m.deployPages())"`. Env CLOUDFLARE_API_TOKEN/ACCOUNT_ID ada di container.

## 6. Cron Coolify (app ini SAJA)

| Task | Cron (UTC) | WIB |
|---|---|---|
| daily-0600 (id5) | `0 23 * * *` | 06:00 |
| hourly-tick (id6, timeout 600) | `0 * * * *` | tiap jam 08–16 jendela publish |
| weekly-Mon-0700 (id7) | `0 0 * * 1` | Senin 07:00 |
| watchdog-vcv-30min (id8) | `0,30 * * * *` | tiap 30 mnt |
| rank-daily-0630 (id9) | `30 23 * * *` | 06:30 |

**JANGAN sentuh task id3 `hourly-publish` & id4 `watchdog-30min` — milik app LAIN
(sbdental), bukan duplikat.** Jangan prune disk VPS / sentuh app lain.

## 7. Akses dashboard

Login WAJIB: email allow-list `beriklan.agency@gmail.com` + username `admin` +
password `UdSmRCGVXr5drdmHj0o7oA2O`. Env `ACCESS_ALLOWED_EMAILS`, `DASHBOARD_ACCESS=enforced`.
Email asing/kosong → 401. (CF Zero Trust belum aktif — `beriklan.co.id` di akun CF
lain, subdomain grey-cloud; lapisan OTP menunggu aksi user.)

## 8. SEO situs (audit 17 Nov, 62 artikel tayang)

100% punya title/meta description(50–165 char)/H1/canonical benar/og:image/JSON-LD;
0 artikel <900 kata; halaman inti (/ , /simulasi-kpr/, /agent/, /nup/, /sale/) lengkap;
robots.txt + sitemap-index valid; llms.txt & llms-full.txt daftar semua artikel &
diregenerasi tiap build. Keyword matriks: artikel tayang dari matriks mengandung
keyword di title/H1/body; sisa keyword tercakup di draf antrean (terbit 6/hari).
`seo/fix-sitemap.mjs` menambah lastmod jujur + image:image per artikel blog (idempoten).

## 9. Prinsip

- "belum diukur ≠ 0" — jangan karang angka; GSC masih 0 klik (situs baru) tampil "—".
- `updated` naik hanya bila konten berubah.
- Gate harga/lint/uniqueness JANGAN dilonggarkan.
- Verifikasi lewat tool sebelum klaim "selesai".
- Untracked sengaja (jangan commit): `URUTAN-KERJA.md`, `session handoff.md`, `seo/mine-business.mjs`.