# runner/ — eksekutor terjadwal + dashboard mesin SEO

Runner ini **minimal**: proses Node tanpa dependency runtime (satu paket `yaml`
pure-JS di-vendor ke image), tanpa Worker, tanpa DB. State ada di `seo/*.json`
(lokal) atau volume `/app/data` (container). Semua langkah adalah perintah CLI
yang bisa dijalankan tangan di terminal yang sama.

## Dua wajah

1. **Dashboard HTTP** (`runner/lib/http.mjs`, dihidupkan `idle.mjs`): 10 halaman
   + login, dirakit per-request dari `collect()` — angka selalu keadaan mesin
   sekarang, bukan snapshot build. noindex 3 lapis, sesi HMAC, mutasi = spawn CLI
   engine yang sama (gerbang fail-closed tidak dilewati). Menggantikan generator
   statis `dashboard/build.mjs` (legacy, lihat bawah).
2. **Pipeline terjadwal** (dipicu Scheduled Task Coolify via `docker exec`):
   daily / tick / weekly / watchdog / rank.

## Kenapa ada `idle.mjs`

Coolify memperlakukan application sebagai service: kalau CMD selesai, container
restart-loop dan `docker exec` berebut dengan poll. Scheduled Task menjalankan
command DI DALAM container, jadi container harus hidup. CMD = idle (bukan
pipeline); idle juga menghidupkan server dashboard + `/healthz` (probe Coolify).

## Jadwal (host UTC; WIB = UTC+7)

| waktu WIB | cron UTC | perintah | isi |
|---|---|---|---|
| 06:00 | `0 23 * * *` | `node runner/daily.mjs` | indexer → generate → publish → report email |
| tiap jam | `0 * * * *` | `node runner/tick.mjs` | catch-up publish 1/jam dalam jendela 09–16 WIB; mencatat run TIAP jam (detak jantung watchdog) |
| Senin 07:00 | `0 0 * * 1` | `node runner/weekly.mjs` | tambang query GSC → `keywords.mined.json` + report |
| tiap 6 jam | `0 */6 * * *` | `node runner/watchdog.mjs` | deteksi scheduler/pipeline mati → alert (read-only) |
| 06:30 | `30 23 * * *` | `node seo/rank.mjs` | posisi keyword GSC + alert turun > `SEO_RANK_DROP` (3) |

Kunci (`lib/lock.mjs`) mencegah dua pipeline menimpa state yang sama; lepas kalau
proses mati. watchdog tidak mengambil lock (hanya membaca).

## Dependency runtime

- **Node ≥ 23.6** (image pakai `node:24-slim`). `generate.mjs` meng-import
  `prompts.ts` lewat type-stripping native — jangan pakai Node 22 + flag
  `--experimental-strip-types` diam-diam; tulis versi Node di Dockerfile.
- Nol npm dependency untuk menjalankan. Satu paket `yaml@2.9.1` (pure-JS,
  zero-dep) di-vendor ke `site/node_modules/yaml` di image supaya `llms.mjs`
  regen llms.txt benar dan `article-lint` menjaga gerbang YAML penuh. Tanpa itu
  llms.txt kosong (0 artikel) + lint turun ke fallback regex yang buta quote rusak.

## Dockerfile & deploy (#20–21)

`runner/Dockerfile`: `node:24-slim` + `curl`/`git`/`ca-certificates`, COPY source
runtime saja (bukan `COPY . .` — `accountscf.md` + backup di-exclude `.dockerignore`),
vendor yaml, healthcheck `/healthz`, **CMD idle**, **tanpa instruksi VOLUME**.

- Persistensi: named volume Coolify `local_persistent_volumes` mount `/app/data`
  (jebakan #15: instruksi `VOLUME` = anonymous volume baru tiap deploy → state hilang).
- `runner/entrypoint.sh`: menyiapkan working tree git (origin HTTPS) saat startup
  bila `GITHUB_TOKEN` ada — `publish-git.mjs` butuh pull/push. Tanpa token →
  dashboard read-only tetap jalan; publish fail-closed (bukan palsu sukses).
- **Publish di container = `seo/publish-git.mjs`** (flip+commit+push, build di
  Cloudflare Pages). `publish.mjs` MENOLAK build in-container (insiden OOM 6 Okt).
  `runner/lib/config.mjs` memilih otomatis via `existsSync('/.dockerenv')`.
- Seed volume saat deploy pertama: salin `seo/{state,config,queue,keywords}.json`
  ke `/app/data`; `node seo/bootstrap-state.mjs` membangun state sahih dari disk.

Build lokal (butuh Docker):

```
docker build -f runner/Dockerfile -t valleycity-seo-runner .
docker run -d --name vcv -v vcv_data:/app/data -p 8080:8080 valleycity-seo-runner
docker inspect vcv --format '{{json .Mounts}}'   # verifikasi named volume
curl localhost:8080/healthz                       # {"ok":true,...}
```

## Kredensial supaya pipeline lengkap

`GROQ_API_KEY` (generator) · `GITHUB_TOKEN` (push) · `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` (tunggu Pages deploy) · `GSC_SERVICE_ACCOUNT_JSON_B64`
(inspeksi + mining + rank) · `BING_API_KEY` (opsional; IndexNow tanpa kunci Bing) ·
`RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` + `NOTIFY_EMAIL_TO` (laporan) ·
`DASHBOARD_USER` + `DASHBOARD_PASS` (login dashboard; kosong = terbuka tapi noindex).

Tanpa salah satunya, langkah terkait **dilewati dan dilaporkan**, bukan dibuat
sukses. Uji: `SEO_NOTIFY_DRYRUN=1`, `SEO_SKIP_INDEXER/GENERATE/PUBLISH=1`.

## State di container

Mount volume `/app/data`; ENV Dockerfile sudah men-set:

```
SEO_STATE_PATH=/app/data/state.json
SEO_CONFIG_PATH=/app/data/config.json
SEO_QUEUE_PATH=/app/data/queue.json
SEO_RUNS_PATH=/app/data/runs.json
SEO_RANK_PATH=/app/data/rank.json
SEO_AUDIT_PATH=/app/data/audit-log.json
SEO_KEYWORDS_PATH=/app/data/keywords.json
```

`keywords.mined.json` ikut volume (diturunkan dari dirname STATE). Lock tetap di
`/tmp` (ephemeral per-container, bukan volume — hindari stale lock lintas-host).

## Dashboard statis lama (legacy)

`dashboard/build.mjs` + `check.mjs` + `dist/` = generator statis lama (proyek CF
Pages "valleyvity" terpisah), sudah digantikan renderer server `seo/dashboard.mjs`.
`dashboard/lib/{data,ui}.mjs` TETAP dipakai (helper bersama). Generator statis
dijadwalkan dihapus setelah deploy server terverifikasi (#21).

## Yang menahan pipeline hari ini

Keyword: 694 approved. `daily_count` ditahan 1 karena belum ada pengukuran GSC
(B2). Deploy dashboard menunggu B1 (DNS `valleycity.beriklan.co.id`) + B9
(kredensial login). Lihat `URUTAN-KERJA.md` untuk blocker lengkap.
