#!/usr/bin/env node
/**
 * seo/publish-git.mjs — alur publish GIT-BASED. VPS tidak pernah build.
 *
 * MASALAH YANG DISELESAIKAN
 * publish.mjs lama menjalankan `pnpm --filter landing build` (Astro, 1.132 artikel)
 * + `wrangler pages deploy` DI DALAM container VPS 3,9 GB — 6x/jam. Hasilnya OOM:
 * app.valleycity.id mati total + sshd tak bisa fork (6 Okt 2026). Arsitektur itu DILARANG.
 *
 * ALUR BARU (semua langkah ringan: file + git + curl, tanpa build)
 *   1. git pull --ff-only (konten terbaru; VPS adalah satu-satunya penulis)
 *   2. Ambil pool draft dari queue (lewati yang dikarantina gate)
 *   3. Gate qc-uniqueness per slug (baca Markdown, tanpa build)
 *   4. Slug ditolak → karantina 7 hari (ditulis ke queue). Gate tetap berkuasa.
 *   5. Flip status:publish + date, tandai published di queue
 *   6. mesh-build (tulis related[] — operasi file, ringan)
 *   7. llms-mdx (regen llms.txt dari Markdown — tanpa dist, tanpa js-yaml)
 *   8. git add + commit + push (Markdown + llms.txt + queue.json)
 *   9. Tunggu Cloudflare Pages selesai build commit tersebut (poll API)
 *  10. Verifikasi tiap URL live (HTTP 200)
 *  11. jsonld-live (validasi JSON-LD dari HTML live — warn-only, karena sudah tayang)
 *  12. indexnow ping + update state.json
 *
 * Build HANYA terjadi di Cloudflare Pages (dari git). VPS tidak pernah build.
 *
 * Usage:
 *   node seo/publish-git.mjs --count=24          # batch (cron tiap 4 jam)
 *   node seo/publish-git.mjs --count=24 --dry-run # lihat kandidat tanpa menulis apa pun
 *   node seo/publish-git.mjs --slug=contoh-slug    # satu artikel spesifik
 *
 * Env:
 *   SEO_QUEUE_PATH, SEO_STATE_PATH, SEO_CONFIG_PATH (queue/state di volume)
 *   SEO_CONTENT_DIR (opsional — default <repo>/site/src/collections/blog)
 *   GITHUB_TOKEN (wajib untuk push — tidak pernah di-print)
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (wajib untuk poll deploy)
 *   SOCIO_INDEXNOW_KEY (untuk IndexNow)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..'); // checkout repo (clone) — perintah ini jalan DARI clone
const BLOG_DIR = process.env.SEO_CONTENT_DIR || join(ROOT, 'site/src/collections/blog');
const QUEUE_PATH = process.env.SEO_QUEUE_PATH || join(ROOT, 'seo/queue.json');
const SITE = 'https://valleycity.id';
const CF_API = 'https://api.cloudflare.com/client/v4';

// Pool lebih besar dari count supaya gate punya kandidat pengganti.
// (Pelajaran 6 Okt 2026: pool == count + 1 slug diblokir = deadlock 44 siklus.)
const POOL_FACTOR = 12;
const POOL_MIN = 24;
const QUARANTINE_MS = 7 * 24 * 3600 * 1000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { count: 24, dryRun: false, slug: null };
  for (const a of args) {
    if (a.startsWith('--count=')) {
      const n = parseInt(a.slice('--count='.length), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`--count= tidak valid: ${a}`);
      opts.count = n;
    } else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--slug=')) opts.slug = a.slice('--slug='.length);
  }
  return opts;
}

// Jangan pernah membocorkan token ke log — semua error git disaring dulu,
// TERMASUK bentuk base64-nya (bocor 6 Okt 2026: pesan error git mencetak
// "AUTHORIZATION: basic <b64>" yang isinya x-access-token:PAT).
function safeErr(e) {
  let msg = String(e?.message || e || '').slice(0, 500);
  const token = process.env.GITHUB_TOKEN || '';
  if (token) {
    msg = msg.split(token).join('***');
    const b64 = Buffer.from(`x-access-token:${token}`).toString('base64');
    msg = msg.split(b64).join('***');
  }
  return msg;
}

function gitAuthArgs() {
  // Repo private → semua operasi jaringan butuh auth. Token lewat extraHeader
  // (tidak di URL, tidak di .git/config). Tanpa ini pull/fetch gagal 403.
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];
  const b64 = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraHeader=AUTHORIZATION: basic ${b64}`];
}

function git(sub, args = [], opts = {}) {
  // execFileSync ARRAY (bukan string) — nilai -c mengandung spasi dan akan
  // pecah kalau lewat shell (bug 6 Okt: "git: 'basic' is not a git command").
  const r = execFileSync('git', [...gitAuthArgs(), sub, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...opts,
  });
  return String(r || '').trim();
}

function pickDrafts(queue, count, slug) {
  const now = Date.now();
  const drafts = queue.items.filter((i) => {
    if (i.status !== 'draft') return false;
    if (i.qcBlockedUntil && Number(i.qcBlockedUntil) > now) return false;
    if (slug) return i.slug === slug;
    return existsSync(join(BLOG_DIR, `${i.slug}.md`));
  });
  if (slug) return drafts;
  return drafts
    .sort(
      (a, b) =>
        (b.priority || 0) - (a.priority || 0) ||
        (a.notes || '').localeCompare(b.notes || ''),
    )
    .slice(0, Math.max(count * POOL_FACTOR, POOL_MIN));
}

function uniquenessGate(slug) {
  try {
    execFileSync(process.execPath, [join(HERE, 'qc-uniqueness.mjs'), '--slug', slug, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SEO_NOTIFY_DRYRUN: '1' },
    });
    return { ok: true, detail: null };
  } catch (e) {
    if (e.status === 1) {
      let detail = null;
      try {
        const j = JSON.parse(e.stdout || '{}');
        detail = (j.failsDetail || []).slice(0, 3).map((p) => `${p.b} (score ${p.score})`);
      } catch {}
      return { ok: false, detail };
    }
    return { ok: true, detail: null, warn: String(e?.message || e).slice(0, 120) };
  }
}

function flipDraft(path) {
  const src = readFileSync(path, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const flipped = src
    .replace(/^status:\s*draft\s*$/m, 'status: publish')
    .replace(/^date:\s*\d{4}-\d{2}-\d{2}\s*$/m, `date: ${today}`);
  if (flipped === src) throw new Error(`frontmatter tidak berubah: ${path}`);
  writeFileSync(path, flipped);
  return today;
}

function runNode(script, args = []) {
  console.log(`  $ node seo/${script} ${args.join(' ')}`);
  execFileSync(process.execPath, [join(HERE, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });
}

async function cfGet(path) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !acct) throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID belum di-set.');
  const res = await fetch(`${CF_API}/accounts/${acct}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Cloudflare API ${res.status} untuk ${path}`);
  return res.json();
}

async function waitForDeploy(commitSha) {
  const short = commitSha.slice(0, 7);
  console.log(`\n=== tunggu Pages deploy commit ${short} ===`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const data = await cfGet(`/pages/projects/${CF_PAGES_PROJECT}/deployments?env=production&per_page=5`);
    const list = data.result || [];
    const match = list.find((d) => {
      const h = d?.deployment_trigger?.metadata?.commit_hash || '';
      return h && (h.startsWith(short) || short.startsWith(h.slice(0, 7)));
    });
    if (match) {
      const stage = match.latest_stage || {};
      console.log(`  deploy ${String(match.id || '').slice(0, 8)}… tahap=${stage.name} status=${stage.status}`);
      if (stage.status === 'success') {
        console.log(`  ✓ deploy sukses: ${match.url || ''}`);
        return match;
      }
      if (stage.status === 'failure') {
        throw new Error(`Pages deploy GAGAL tahap=${stage.name}. Cek dashboard Cloudflare. Markdown sudah ter-push — JANGAN revert otomatis.`);
      }
    } else {
      console.log('  … deploy commit ini belum muncul di API (Pages antre/clone)');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Timeout 20 menit menunggu Pages deploy. Markdown sudah ter-push — cek dashboard, JANGAN revert otomatis.');
}

async function verifyUrls(urls) {
  console.log('\n=== verifikasi URL live ===');
  for (const u of urls) {
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try {
        const res = await fetch(u, { redirect: 'follow' });
        const body = await res.text();
        ok = res.ok && body.length > 2000;
        console.log(`  ${ok ? '✓' : `✗(${res.status})`} ${u} (usaha ${attempt})`);
      } catch (e) {
        console.log(`  ✗(jaringan) ${u} (usaha ${attempt})`);
      }
      if (!ok) await new Promise((r) => setTimeout(r, 15000));
    }
    if (!ok) throw new Error(`URL tidak live setelah deploy: ${u}`);
  }
}

async function main() {
  const opts = parseArgs();
  // Identitas commit via env (git commit tidak menerima -c setelah subcommand).
  process.env.GIT_AUTHOR_NAME ||= 'opencode';
  process.env.GIT_AUTHOR_EMAIL ||= 'noreply@opencode.ai';
  process.env.GIT_COMMITTER_NAME ||= 'opencode';
  process.env.GIT_COMMITTER_EMAIL ||= 'noreply@opencode.ai';
  console.log(`publish-git: root=${ROOT}`);
  console.log(`publish-git: blog=${BLOG_DIR} (${opts.dryRun ? 'DRY-RUN' : `count=${opts.count}`})`);

  // 1) Sinkron dengan git — VPS adalah satu-satunya penulis, jadi harus fast-forward.
  console.log('\n=== git pull ===');
  try {
    console.log('  ' + git('pull', ['--ff-only']).split('\n')[0]);
  } catch (e) {
    throw new Error(`git pull gagal (ada commit lain di remote?): ${safeErr(e)}`);
  }

  const queue = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
  const targets = pickDrafts(queue, opts.count, opts.slug);
  if (!targets.length) {
    console.log('Tidak ada draft siap publish.');
    process.exit(1);
  }

  // 2-3) Gate per slug sampai kuota terpenuhi.
  const cleared = [];
  const blockedByGate = [];
  console.log(`\nGate qc-uniqueness — ${targets.length} kandidat:`);
  for (const t of targets) {
    if (cleared.length >= opts.count) break;
    const g = uniquenessGate(t.slug);
    if (g.warn) console.log(`  ⚠ ${t.slug}: gate error (tidak memblokir) — ${g.warn}`);
    if (g.ok) {
      cleared.push(t);
      console.log(`  ✓ ${t.slug}`);
    } else {
      blockedByGate.push({ t, detail: g.detail || [] });
      console.log(`  ✗ ${t.slug} DITOLAK — mirip: ${(g.detail || []).join(', ')}`);
    }
  }
  if (blockedByGate.length) {
    const until = new Date(Date.now() + QUARANTINE_MS).toISOString().slice(0, 10);
    for (const { t, detail } of blockedByGate) {
      t.qcBlockedUntil = Date.now() + QUARANTINE_MS;
      t.qcBlockedDate = until;
      t.qcBlockCount = (t.qcBlockCount || 0) + 1;
      t.qcBlockedReason = detail.join('; ');
    }
    console.log(`\n${blockedByGate.length} slug dikarantina sampai ${until}. Gate tetap berlaku.`);
  }

  if (opts.dryRun) {
    console.log(`\n[dry-run] akan publish ${cleared.length}: ${cleared.map((t) => t.slug).join(', ')}`);
    console.log('[dry-run] tidak ada file yang ditulis, tidak ada push.');
    return;
  }

  // Queue WAJIB ditulis walau cleared kosong (karantina harus bertahan antar-siklus).
  if (!cleared.length) {
    writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');
    console.log('\nSemua kandidat dikarantina — tidak ada yang dipublish siklus ini.');
    process.exitCode = 1;
    return;
  }

  // 4) Flip + tandai published.
  const publishedUrls = [];
  for (const t of cleared) {
    const path = join(BLOG_DIR, `${t.slug}.md`);
    console.log(`\n--- publish ${t.slug} ---`);
    const today = flipDraft(path);
    t.status = 'published';
    t.notes = (t.notes || '').replace(/\s*\|\s*generated[^\n]*/, '').trim();
    t.notes = (t.notes ? t.notes + ' | ' : '') + `published ${today}`;
    publishedUrls.push(`${SITE}/blog/${t.slug}/`);
    console.log(`  status:publish, date:${today}`);
  }
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');

  // 5) Mesh + llms (operasi file, ringan — TANPA build).
  console.log('\n=== mesh-build ===');
  runNode('mesh-build.mjs', ['--write']);
  console.log('\n=== llms-mdx ===');
  runNode('llms-mdx.mjs');

  // 6) Commit + push (queue ikut di-commit sebagai jejak audit).
  copyFileSync(QUEUE_PATH, join(ROOT, 'seo/queue.json'));
  console.log('\n=== git commit + push ===');
  try {
    git('add', ['site/src/collections/blog', 'site/public/llms.txt', 'site/public/llms-full.txt', 'seo/queue.json']);
    const changed = git('status', ['--porcelain']);
    if (!changed) {
      console.log('  tidak ada perubahan untuk di-commit (aneh — flip seharusnya mengubah Markdown)');
      process.exit(1);
    }
    const msg = `publish(seo): ${cleared.length} artikel — ${cleared.map((t) => t.slug).join(', ').slice(0, 200)}`;
    git('commit', ['-q', '-m', msg]);
    const sha = git('rev-parse', ['HEAD']);
    console.log(`  commit ${sha.slice(0, 7)}`);
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN belum di-set — tidak bisa push.');
    // git() sudah menyertakan http.extraHeader auth — push polos aman.
    execFileSync('git', [...gitAuthArgs(), 'push', 'origin', 'HEAD:main'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    console.log('  ✓ pushed ke main');

    // 7) Tunggu Pages build commit ini.
    await waitForDeploy(sha);

    // 8) Verifikasi live.
    await verifyUrls(publishedUrls);

    // 9) Validasi JSON-LD dari HTML live (warn-only — sudah tayang, tidak bisa di-block).
    console.log('\n=== jsonld-live ===');
    try {
      runNode('jsonld-live.mjs', publishedUrls);
    } catch (e) {
      console.log('  ⚠ jsonld-live memberi peringatan (lihat di atas) — lanjut, sudah tayang.');
    }

    // 10) IndexNow + state.
    console.log('\n=== indexnow ===');
    const r = spawnSync(process.execPath, [join(HERE, 'indexnow.mjs'), ...publishedUrls], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    if (r.status !== 0) console.log('  ⚠ indexnow exit bukan 0 — cek log di atas (URL tetap live).');

    console.log(`\nDone: ${publishedUrls.length} artikel live via git:`);
    for (const u of publishedUrls) console.log(`  ${u}`);
  } catch (e) {
    console.error(`\nFATAL: ${safeErr(e)}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', safeErr(e));
  process.exit(1);
});
