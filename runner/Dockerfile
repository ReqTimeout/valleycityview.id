# syntax=docker/dockerfile:1
# valleycity-seo-runner — dashboard + runner SEO 24/7 untuk valleycityview.id (#18–20).
#
# Prinsip (mengikuti pola sbdental app/runner/Dockerfile):
#  - Runtime ZERO npm dependency: semua skrip runner/ + seo/ pakai built-in Node.
#    Satu-satunya paket yang di-vendor adalah `yaml` (pure-JS, zero-dep) supaya
#    llms.mjs regen llms.txt benar dan article-lint menjaga gerbang YAML penuh
#    (tanpa itu llms.txt kosong + lint turun ke fallback regex yang buta quote).
#  - Node 24: generate.mjs meng-import prompts.ts lewat type-stripping native
#    (>= 23.6). Jangan pakai Node 22 + flag --experimental-strip-types diam-diam.
#  - CMD = idle, BUKAN pipeline. Coolify menganggap application = service; kalau
#    CMD exit, container restart-loop. Pipeline dipicu Scheduled Task via
#    `docker exec` (daily/tick/weekly/watchdog/rank). idle.mjs juga menghidupkan
#    server dashboard (node:http) yang menyajikan /healthz + 10 halaman.
#  - Publish di container = publish-git.mjs (flip+commit+push, build di Cloudflare
#    Pages). publish.mjs MENOLAK build in-container (insiden OOM 6 Okt). Working
#    tree git disiapkan entrypoint.sh saat startup bila GITHUB_TOKEN ada.
#  - State di named volume Coolify /app/data. BUKAN instruksi VOLUME — itu bikin
#    anonymous volume baru tiap deploy → state hilang (jebakan #15). Persistensi
#    dari baris `local_persistent_volumes` (DB Coolify): mount_path=/app/data.
FROM node:24-slim

LABEL org.opencontainers.image.title="valleycity-seo-runner" \
      org.opencontainers.image.description="Dashboard + runner SEO valleycityview.id (daily/tick/weekly/watchdog/rank); publish via git -> Cloudflare Pages"

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Jakarta \
    PORT=8080 \
    SEO_STATE_PATH=/app/data/state.json \
    SEO_CONFIG_PATH=/app/data/config.json \
    SEO_QUEUE_PATH=/app/data/queue.json \
    SEO_RUNS_PATH=/app/data/runs.json \
    SEO_RANK_PATH=/app/data/rank.json \
    SEO_AUDIT_PATH=/app/data/audit-log.json \
    SEO_KEYWORDS_PATH=/app/data/keywords.json

# curl: healthcheck Coolify DI DALAM container (node:24-slim tak punya curl).
# git: publish-git pull/push. ca-certificates: fetch HTTPS (GSC/CF/Resend).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Hanya source yang dipakai runtime. JANGAN `COPY . .` — repo punya accountscf.md
# + backup WP yang tidak boleh masuk image (lihat .dockerignore).
COPY runner ./runner
COPY seo ./seo
COPY dashboard/lib ./dashboard/lib
COPY audit ./audit
COPY site/scripts ./site/scripts
COPY site/src/collections/blog ./site/src/collections/blog
COPY site/src/data ./site/src/data
COPY site/public ./site/public

# Vendor YAML dari site/node_modules (sudah di-pin 2.9.1 di package-lock situs).
# createRequire(site/noop.js) me-resolve dari /app/site/node_modules → yaml ada.
# Di-copy dari context (bukan npm i) supaya build tidak bergantung registry.
COPY site/node_modules/yaml ./site/node_modules/yaml

RUN mkdir -p /app/data \
 && chmod +x /app/runner/entrypoint.sh \
 && git config --global --add safe.directory /app \
 && test -f /app/site/node_modules/yaml/package.json

# JANGAN pakai `VOLUME ["/app/data"]` (jebakan #15: anonymous volume tiap deploy).
# Coolify mount named volume ke /app/data via local_persistent_volumes.
# Seed volume saat deploy pertama: salin seo/{state,config,queue,keywords}.json
# ke /app/data (lihat runner/README.md "State di container").

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/runner/entrypoint.sh"]
CMD ["node", "runner/idle.mjs"]
