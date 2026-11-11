# dashboard/ — valleyvity

Dashboard internal status SEO Valley City. Ini **proyek Cloudflare Pages
TERPISAH** dari situs publik — bukan bagian dari `site/`, dan tidak boleh
pernah muncul di domain valleycity.id.

## Cara kerja

`node dashboard/build.mjs` membaca state repo (`seo/state.json`,
`seo/config.json`, `seo/runs.json`, `seo/queue.json`, `seo/keywords.json`,
`audit/posts.json`, collection blog) dan menulis **HTML statis** ke
`dashboard/dist/`. Tidak ada server, tidak ada Worker, tidak ada database,
tidak ada JavaScript di browser. Angka dihitung saat build; halaman bukan
waktu nyata.

Enam halaman: Overview (`/`), Antrean (`/queue/`), URL (`/urls/`),
Konten (`/content/`), Runs (`/runs/`), Health (`/health/`).

```
node dashboard/build.mjs   # tulis dashboard/dist/
node dashboard/check.mjs   # gerbang: noindex 3 lapis, nol JS, nol bocor path
```

`check.mjs` gagal (exit 1) kalau ada halaman hilang, `<script>` nyelip,
`undefined`/`NaN` ter-render, path mesin build (`/Users/...`, `/Volumes/...`)
bocor ke HTML, satu halaman > 60 KB, atau tabel > 70 baris. Jalankan
sesudah build; `check.mjs --build` menjalankan build dulu.

## Prinsip kejujuran angka

Sama seperti `seo/`: hal yang belum diukur ditulis **belum diukur**, bukan 0.
Index rate dengan n=0 tidak boleh dibaca sebagai 0%; trafik tanpa berkas
`seo/keywords.mined.json` tidak ditaksir. Kalau suatu kolom kosong di
dashboard, artinya pengukuran memang belum pernah terjadi — cari penyebabnya
di halaman Health, bukan curiga sama Google.

## noindex — tiga lapis

1. `<meta name="robots" content="noindex,nofollow">` di setiap halaman
2. `dashboard/dist/robots.txt` → `Disallow: /`
3. `dashboard/dist/_headers` → `X-Robots-Tag: noindex, nofollow` (+ `no-store`)

Ketiganya dicek `check.mjs`. Tidak terindeks **bukan** proteksi — itu cuma
lapisan malu. Proteksi sebenarnya adalah Cloudflare Access (lihat di bawah),
dan statusnya harus dinyatakan lewat `DASHBOARD_ACCESS` saat build supaya
halaman tidak boleh mengklaim diri terlindungi kalau tidak ada yang
menyatakannya.

## Deploy

Prasyarat yang **sudah terverifikasi tidak ada** (Nov 2026, queried via API
dengan token di `accountscf.md` — file ini gitignored):

- Zona DNS `beriklan.co.id` TIDAK ada di akun Cloudflare `182b2b21327ac5d3a446d2ddbc9af05f`.
  Domain `valleyvity.beriklan.co.id` tidak bisa dipasang sampai zona itu
  dipindah/ditambahkan ke akun ini.
- Proyek Pages `valleyvity` belum ada (yang ada: sbdental, myprospect,
  jualpotcream, xlhomeinternet).
- Semua zona di akun ini plan **Free** — Cloudflare Access untuk Pages butuh
  plan berbayar, jadi enforce Access kemungkinan besar tidak bisa aktif
  sebelum akun di-upgrade.

Kalau zona belum siap, deploy tetap bisa ke subdomain
`valleyvity.pages.dev` (URL acak yang tidak diumumkan). Itu bukan proteksi —
siapa pun yang tahu URL-nya bisa masuk. Karena itu halaman akan menampilkan
chip Access apa adanya:

| `DASHBOARD_ACCESS` | Arti di footer halaman |
|---|---|
| `enforced` | login Access wajib; tanpa itu halaman tidak disajikan |
| `enforce-off` | Access terpasang tapi enforce OFF — terbuka bagi yang tahu URL |
| `not-configured` (default) | tidak ada Access; hanya tidak terindeks, itu BUKAN proteksi |

```
DASHBOARD_ACCESS=<mode> node dashboard/build.mjs && node dashboard/check.mjs
npx wrangler pages project create valleyvity --production-branch main
npx wrangler pages deploy dashboard/dist --project-name valleyvity
```

Setelah deploy, di dashboard Cloudflare (tidak bisa di-otomasi dari sini):

1. **Pages → valleyvity → Custom domains**: tambahkan
   `valleyvity.beriklan.co.id` (butuh zona `beriklan.co.id` di akun ini).
2. **Zero Trust → Access → Applications**: application type **Self-hosted**,
   domain `valleyvity.beriklan.co.id` (dan/atau `valleyvity.pages.dev`),
   policy **Allow** untuk email operator, session 24 jam.
   **Email allow-list — jangan pernah token di query string.**
3. Ulangi build dengan `DASHBOARD_ACCESS=enforced` (atau `enforce-off` kalau
   Access baru dibuat tapi mode enforce masih OFF) lalu deploy ulang, supaya
   klaim di footer cocok dengan kenyataan.

Sampai langkah 2 benar-benar dilakukan, status jujur dashboard ini adalah:
**terbuka tapi tak terindeks**.
