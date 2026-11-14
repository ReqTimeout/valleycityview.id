#!/bin/sh
# runner/entrypoint.sh — siapkan working tree git untuk publish-git, lalu exec CMD.
#
# publish-git.mjs melakukan `git pull --ff-only` + `git push origin HEAD:main`
# dari /app. Tanpa working tree git, publish gagal. Image hanya meng-COPY source
# (tanpa .git — 411MB, dan remote lokal SSH tak terpakai di container). Maka
# working tree git disiapkan SAAT STARTUP, hanya bila GITHUB_TOKEN ada (deploy).
#
# Tanpa GITHUB_TOKEN → dashboard read-only tetap jalan dari source di image;
# publish-git akan menolak sampai token/jaringan beres (fail-closed, bukan palsu).
#
# Auth lewat http.extraHeader (bukan URL) supaya token tidak bocor ke log/remote.
set -eu
cd /app

git config --global --add safe.directory /app || true
git config --global user.name "${GIT_AUTHOR_NAME:-opencode}" || true
git config --global user.email "${GIT_AUTHOR_EMAIL:-noreply@opencode.ai}" || true

if [ -n "${GITHUB_TOKEN:-}" ] && [ ! -d /app/.git ]; then
  echo "[entrypoint] menyiapkan working tree git (origin HTTPS) untuk publish-git..."
  B64=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
  AUTH="http.extraHeader=AUTHORIZATION: basic $B64"
  REMOTE="https://github.com/ReqTimeout/valleycityview.id.git"
  # fetch penuh (bukan shallow) supaya push dari container diterima GitHub.
  if git init -q -b main /app \
     && git -C /app remote add origin "$REMOTE" \
     && git -C /app -c "$AUTH" fetch -q origin main \
     && git -C /app -c "$AUTH" checkout -q -B main FETCH_HEAD \
     && git -C /app branch --set-upstream-to=origin/main main; then
    echo "[entrypoint] working tree git siap di main."
  else
    echo "[entrypoint] PERINGATAN: setup git gagal — dashboard read-only tetap jalan; publish-git butuh GITHUB_TOKEN/jaringan beres." >&2
  fi
fi

exec "$@"
