# runner/ — eksekutor terjadwal mesin SEO

Runner ini sengaja **minimal**: satu proses Node tanpa dependency, tanpa Worker,
tanpa DB. Semua state ada di repo (`seo/*.json`) dan semua langkah adalah
perintah yang bisa Anda jalankan tangan di terminal yang sama.

## Kenapa ada `idle.mjs`

Coolify memperlakukan application sebagai service: kalau CMD selesai, container
di-restart terus-menerus (`restart loop`) dan `docker exec` jadi berebut dengan
poll. Scheduled Task Coolify menjalankan command **di dalam** container aplikasi,
jadi container harus hidup. Karena itu CMD bawaan adalah idle, bukan pipeline —
pipeline dipicu oleh Scheduled Task.

## Jadwal

| waktu | perintah | isi |
|---|---|---|
| 06:00 WIB | `node runner/daily.mjs` | ramp-gate → indexer → generate → publish → indexnow → report email |
| Senin 07:00 WIB | `node runner/weekly.mjs` | tambang query GSC, lapor klik/impressi, mining keyword baru ke `keywords.mined.json` |

Kunci (`lib/lock.mjs`) mencegah dua pipeline berjalan menimpa state yang sama.
Lock lepas kalau proses mati; tidak ada daemon yang membersihkannya.

## Dependency runtime

- **Node ≥ 23.6** (kami mengembangkan di 24.x). `seo/generate.mjs` meng-
  `import('./prompts.ts')` tanpa langkah build — butuh type-stripping native.
  Di Node 22.x ini hanya jalan dengan `--experimental-strip-types`; jangan pakai
  itu diam-diam di image — tulis versi Node-nya di Dockerfile, jangan di flag.
- Tidak ada `package.json` untuk runner: nol dependency, hanya modul `node:*`.
- **Belum ada Dockerfile.** Image harus dibuat saat deploy (Fase 11+):
  `node:24-slim`, checkout repo dengan akses tulis ke `seo/`, git configured,
  CMD `node runner/idle.mjs`. Menjalinkan image tanpa itu = runner jalan tapi
  tidak bisa commit apa pun.

## Butuh kredensial ini supaya pipeline lengkap

`GROQ_API_KEY` (generator) · `GITHUB_TOKEN` (push hasil) · `CLOUDFLARE_API_TOKEN`
+ `CLOUDFLARE_ACCOUNT_ID` (tunggu Pages deploy selesai) ·
`GSC_SERVICE_ACCOUNT_JSON` (inspeksi indeks + mining query) · `BING_API_KEY` +
`BING_SITE_URL` (opsional; IndexNow tidak butuh kunci Bing) · `RESEND_API_KEY` +
`NOTIFY_EMAIL_FROM` + `NOTIFY_EMAIL_TO` (laporan).

Tanpa salah satunya, langkah terkait **dilewati dan dilaporkan**, tidak dibuat-
buat sukses: `daily.mjs` mencetak `INDEXER GAGAL`/`SKIP` dan mengirim report
dengan status itu apa adanya. Untuk uji tanpa email: `SEO_NOTIFY_DRYRUN=1`;
untuk melewati langkah tertentu: `SEO_SKIP_INDEXER=1`, `SEO_SKIP_GENERATE=1`,
`SEO_SKIP_PUBLISH=1`.

## State di container

Mount volume persistent di `/app/data` dan set:

```
SEO_STATE_PATH=/app/data/state.json
SEO_CONFIG_PATH=/app/data/config.json
SEO_QUEUE_PATH=/app/data/queue.json
```

Kalau tidak di-set, runner menulis ke `seo/` di worktree — benar untuk lokal,
salah untuk container yang image-nya bisa diganti. `state.seed.json` hanya
bootstrap kosong; state yang sahih dibangun dari disk oleh
`node seo/bootstrap-state.mjs`.

## Yang menahan pipeline hari ini

Gerbang keyword masih tertutup (`seo/keywords.json._meta.approved_at = null`)
dan `daily_count` ditahan di 1 karena belum ada pengukuran GSC. Keduanya
sengaja: lihat `seo/README.md` §"Gerbang dan artinya hari ini".
