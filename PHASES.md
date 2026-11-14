# PHASES — Dashboard Svelte 5 + Deploy Coolify (valleycity)

> Catatan kerja per-phase supaya tidak salah urut. Centang `[x]` hanya setelah
> acceptance criterion phase itu benar-benar lolos (dibuktikan output tool).
> Prinsip mesin tetap: **gerbang fail-closed tidak dilewati**, **belum diukur ≠ 0**,
> **rahasia tidak masuk repo**, **runtime zero-dep** (container tanpa npm).

## Keputusan arsitektur (kunci — jangan diubah tanpa alasan kuat)

**Svelte 5 (runes) + Vite, di-compile LOKAL → bundle statis di `runner/assets/`,
disajikan server `node:http` zero-dep yang SUDAH ADA + JSON API tipis.**

Alasan (dicatat agar tidak salah pilih):
- Server existing (`runner/lib/http.mjs`) sudah teruji: auth HMAC, sesi, noindex
  3 lapis, mutasi = spawn CLI engine (gerbang tetap), audit log. **Tidak ditulis
  ulang** — Svelte hanya lapisan tampilan. Risiko regress keamanan = minimal.
- Runtime tetap **zero-dep** → image ringan, **tidak ada npm/build di VPS**
  (disk sisa 7.8GB, RAM tanpa swap, ada ollama). Build terjadi di laptop;
  bundle di-commit seperti `runner/assets` sekarang. Ini menghormati batas keras
  user: jangan OOM, jangan ganggu project lain.
- SvelteKit + adapter-node DITOLAK untuk saat ini: menambah node_modules runtime
  + build di container = berat di VPS yang mepet, dan menulis ulang auth/spawn
  yang sudah proven. SPA di balik login sudah cukup untuk dashboard ops internal
  (noindex, bukan halaman SEO). Situs publik tetap Astro di Cloudflare Pages.
- Chart digambar **SVG sendiri** (sparkline/bar/line) — tanpa dependency chart,
  separable by luminance + label langsung, sesuai design system existing.

Sumber data: `dashboard/lib/data.mjs#collect()` (snapshot tunggal) +
`seo/dashboard.mjs#buildTracking()` + `seo/rank.mjs#readRank()` +
`runner/lib/audit.mjs#readAudit()`. Design token: `runner/assets/dashboard.css`
(forest-teal `#12332c` + gold `#c9a227`/`#fee203` + netral pasir, dark mode).

## Peta halaman (10) — faithful + elevated
| Route | Judul | Isi |
|---|---|---|
| `/` | Overview | KPI keadaan mesin, funnel, alert ringkas, recent |
| `/traffic` | Traffic | klik/impresi GSC, top query, rank + delta |
| `/queue` | Antrean | keyword approved, kuota ramp, search/filter/sort, drawer |
| `/content` | Konten | tayang/draft/redirect, detail drawer |
| `/tracking` | Tracking | funnel produksi, skor kualitas, internal link, yatim |
| `/urls` | URL | peta URL tayang + IndexNow |
| `/indexasi` | Indexasi | inspeksi GSC per URL + index rate |
| `/runs` | Runs | riwayat pipeline + audit log mutasi |
| `/health` | Health | sitemap, berkas state, kredensial, proteksi |
| `/alerts` | Alerts | alert mesin + blocker pipeline |

---

## Phase 0 — Pra-syarat ✅
- [x] Token Coolify id 8 abilities = `["root"]` (deploy aktif) — diverifikasi DB.
- [x] Kredensial dashboard dibuat: `admin` / (di `/tmp/vcv-dashboard-creds.txt`,
      chmod 600, tidak masuk repo). Akan di-set ke env Coolify saat deploy.
- [x] Project `valleycity` (uuid `kdljdtyt8zmmzvj3gizdtzct`) + app
      `valleycity-seo-runner` (uuid `xkyc6wt6lh5avl5tvtghortw`, id 4).
- [x] Named volume `xkyc6wt6lh5avl5tvtghortw_data` → `/app/data` (DB, app 4 saja).
- [x] Healthcheck `/healthz` enabled. 5 scheduled task (disabled, command benar).
- [x] App code commit `03f480da` + push ke `main` (GitHub publik, Coolify clone).

## Phase 1 — Toolchain Svelte 5 + Vite (build lokal → runner/assets) ✅
- [x] `web/package.json` (svelte 5, vite 6, @sveltejs/vite-plugin-svelte) — dev only.
- [x] `web/vite.config.js`: output flat `app.js`+`app.css` ke `../runner/assets`,
      base `/assets/`, single bundle (inlineDynamicImports, cssCodeSplit false).
- [x] `web/index.html` + `web/src/main.js` mount App ke `#app`.
- [x] `web/.gitignore` (node_modules, dist). Root `.gitignore` sudah cover `node_modules/`.
- [x] `npm install` di web/ + `npm run build` menghasilkan bundle.
- **Acceptance ✅:** `runner/assets/app.js` (±120KB) + `app.css` (±23KB) ada; build
  **0 warning**; bundle memuat kode Svelte penuh (150 modul). Shell = `index.html`.

## Phase 2 — JSON API + SPA shell di server zero-dep ✅
- [x] `runner/lib/http.mjs`: `GET /api/data` (auth-gated) → { ...collect(),
      tracking, rank, audit (mutation-log), decisions (keep/redirect), auth, user }.
      `GET /api/session`. `collect()` kini expose `posts`.
- [x] Mutasi `/api/*`: balas JSON bila `Accept: application/json` (fetch), tetap
      303 untuk form. Gerbang spawn + audit TIDAK berubah.
- [x] Route halaman GET → sajikan SPA shell (`runner/assets/index.html`) bila authed;
      login tetap server-rendered (`seo/login.mjs`). noindex tetap.
- [x] `serveAsset` izinkan `index.html`/`app.js`/`app.css` (flat, cocok regex).
- **Acceptance ✅:** `curl /api/data` (cookie) → JSON valid; tanpa cookie → 401;
  `/` sajikan shell; `/healthz` terbuka; `X-Robots-Tag: noindex`; 0 path bocor.

## Phase 3 — Fondasi app Svelte (design system + shell + state) ✅
- [x] Token CSS di-port ke `web/src/app.css` (forest/gold, dark, scrollbar kustom).
- [x] Store runes `lib/state.svelte.js`: Data (fetch/refresh/run), Router (history,
      10 route), UI (tema persist, drawer, toast, confirm).
- [x] Komponen shell: Sidebar (nav grouped + badge), Topbar mobile, Dock, Drawer,
      Toasts, Confirm, Icon set SVG.
- [x] Primitif: Kpi (count-up + reduced-motion), Card, Chip, DataTable (sort/search/
      filter/paginate), Drawer detail (Escape), Sparkline/BarChart/StackedBar/Donut
      SVG, EmptyState ("belum diukur").
- **Acceptance ✅:** shell render, navigasi client-side jalan, dark toggle persist
  (false→true teruji), drawer mobile + dock jalan, toast/confirm muncul.

## Phase 4 — 10 halaman (data nyata + interaksi) ✅
- [x] Overview, Traffic, Queue, Content, Tracking, URLs, Indexasi, Runs, Health,
      Alerts — semua dari snapshot, angka jujur (null → "belum diukur").
- [x] Queue/Content/URLs: search + filter status/kategori + sort + drawer detail.
- [x] Runs: tombol Jalankan harian / Generate / Publish (fetch JSON, confirm modal,
      toast, refresh runs). Indexasi: tombol Inspeksi GSC.
- [x] Traffic: chart klik + rank delta (turun >3 = chip bad). Funnel warna semantik.
- **Acceptance ✅:** 10 halaman render data nyata, **0 console/page error**;
  search terbukti filter (whoosh→4 baris semua cocok, istilah asing→0+empty);
  drawer buka/tutup+Escape stabil; sort + tema + confirm modal teruji.

## Phase 5 — Polish + QA visual ✅
- [x] Entrance stagger (reveal --i), micro-interaction, hover/active, layer depth.
- [x] Responsif desktop + mobile (390px) tanpa overflow/clipping/overlap.
- [x] Scrollbar kustom, kontras terbaca, focus state, aria (scrim role+keyboard,
      drawer dialog+Escape, confirm dialog+Escape).
- [x] Uji runtime Playwright: screenshot desktop (13) + mobile (7) di `/tmp/vcv-shots`;
      0 error; navigasi + drawer + tema + confirm stabil. Vision audit: 0 cacat visual.
- [x] Verifikasi mobile dock: `fixed bottom:0`, content padding-bottom 96px, kartu
      terakhir di atas dock pada max-scroll (tidak tertutup). Artefak fullPage dipahami.
- **Acceptance ✅:** screenshot nyata tersimpan; 0 error; primary flow lengkap;
  refinement funnel semantik + KPI null deliberate terverifikasi vision.

## Phase 6 — Build final + uji lokal + commit ✅
- [x] `npm run build` final → bundle 0 warning. `node --check` server OK.
- [x] E2E lokal port 8099 (auth admin/creds-uji-lokal, COOKIE_SECURE=false): healthz 200,
      login, 10 halaman, /api/data, noindex, 0 path bocor, 0 error.
- [x] Commit terpisah + push: `c7bbc6d4` (Svelte) → `a63486ab` (Health jujur) →
      `d267a38c` (vendor yaml). Secret-scan bersih; 3 docs tetap untracked.
- **Acceptance ✅:** E2E hijau; bundle + server ter-push (HEAD=origin/main=`d267a38c`);
  tidak ada rahasia ter-commit.

## Phase 7 — Deploy Coolify + verifikasi ✅
- [x] Env app (is_runtime): DASHBOARD_USER/PASS (dari `/tmp/vcv-dashboard-creds.txt`)
      + SEO_MINED_PATH=/app/data/keywords.mined.json. **3 env unik** (duplikat trap
      #13/#18 muncul → DELETE). SEO_*_PATH + TZ sudah di-bake Dockerfile (ENV).
- [x] Deploy: POST /start → poll. **Deploy pertama GAGAL** (`COPY site/node_modules/yaml`
      not found) — Coolify build dari git clone GitHub, node_modules di-gitignore →
      yaml absen di context. Fix: commit vendor yaml@2.9.1 (`d267a38c`). Redeploy →
      **`running:healthy`**, commit build = `d267a38c` = HEAD.
- [x] Seed volume: cp -n seo/{state,config,queue,keywords,runs}.json → /app/data.
      State nyata: 54 published, 694 keyword approved. Mount = **named volume**
      `xkyc6wt6lh5avl5tvtghortw_data` (bukan anonymous). YAML-OK di image.
- [x] Enable 5 scheduled task (PATCH enabled:true → 5/5). Cron WIB→UTC benar.
- [x] Verifikasi live https://valleycity.beriklan.co.id: healthz 200; noauth / →302
      login, /api/data→401; login→303; /api/data authed→200 (live 54, keywords 694,
      tracking avg 70, indexRate null jujur); noindex 3 lapis; bundle 200. Browser
      Playwright: 10 halaman render, **0 error**, 0 overflow. Health: "Login app aktif".
- [x] Resource aman: RAM available ±5615MB (no OOM), disk 7.0G free (tanpa prune).
      Project lain (openwa/wa-assistant, sbdental, coolify-proxy) tetap Up healthy.
- **Acceptance ✅:** domain live + login + dashboard Svelte tampil + state nyata +
  5 task aktif; project lain tak tersentuh; tidak OOM.

## Jebakan baru (dicatat agar tidak terulang)
- **Coolify build dari git clone GitHub** → berkas yang di-gitignore (mis.
  `site/node_modules/yaml`) TIDAK ada di build context, walau `.dockerignore` punya
  negation `!site/node_modules/yaml`. Vendor yang di-COPY Dockerfile **wajib di-commit**
  (force-add). Negation .dockerignore hanya menyaring context, bukan mengadakan file.
- `POST /applications/{uuid}/envs` menolak field `is_build_time` (422). Cukup
  `{key, value, is_runtime}`. Duplikat tetap muncul → GET + DELETE dupe (loop `read`
  harus `|| [ -n "$U" ]` agar baris terakhir tanpa newline ikut terproses).
- `PATCH /applications/{uuid}/scheduled-tasks/{uuid}` `{enabled:true}` **jalan** (200),
  beda dengan PATCH envs yang bug.

## Status eksekusi
- **Phase 0–7: ✅ SELESAI.** Dashboard Svelte live di https://valleycity.beriklan.co.id
  (login admin), state nyata ter-seed di named volume, 5 scheduled task aktif.
- HEAD = origin/main = `d267a38c`. Bundle `runner/assets/{index.html,app.js,app.css}`.
- **Sisa blocker pipeline (bukan dashboard):** B8 GITHUB_TOKEN, B2 GSC OAuth user,
  B5 GROQ/MiniMax belum ada → langkah generate/publish/indexer/rank **skip jujur**
  (fail-closed). Dashboard read-only berfungsi penuh; pipeline aktif begitu creds di-set.
- Follow-up terpisah: #34 sync docs, #29 landing cleanup, pensiunkan dashboard statis
  (`dashboard/build.mjs`+`check.mjs`+`dist/`; `dashboard/lib` tetap dipakai server).
- Server uji lokal 8099 sudah dimatikan. Screenshot QA: `/tmp/vcv-shots/`.