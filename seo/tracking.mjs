/**
 * seo/tracking.mjs — tracking internal konten (GAP-ANALYSIS B): funnel produksi,
 * skor kualitas 0–100 per artikel, graf internal link, dan artikel yatim.
 *
 * Semua dibaca dari disk (collection blog + queue + state). Tidak ada angka
 * yang dikarang: artikel tanpa body terbaca ditulis apa adanya. Skor adalah
 * heuristik teknis (bukan penilaian editorial) — bobotnya eksplisit di bawah.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOG_DIR } from './paths.mjs';
import { posts } from './lib/live-posts.mjs';
import { MONEY_PAGES } from './site.mjs';

const NL = String.fromCharCode(10);

export const SKOR_RULES = { words: 25, h2: 15, faq: 20, image: 15, related: 10, money: 10, meta: 5 };

function parse(file) {
  const src = readFileSync(join(BLOG_DIR, file), 'utf8');
  const end = src.indexOf(NL + '---', 3);
  const fm = end > 0 ? src.slice(0, end) : '';
  const body = end > 0 ? src.slice(end + 4) : src;
  const grab = (k) => (fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]*)"?\\s*$`, 'm')) || [])[1]?.trim() || null;
  const list = (k) => {
    const m = fm.match(new RegExp(`^${k}:\\s*\\n((?:\\s*-\\s.*\\n?)+)`, 'm'));
    if (!m) {
      const inline = fm.match(new RegExp(`^${k}:\\s*\\[([^\\]]*)\\]`, 'm'));
      return inline ? inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
    }
    return [...m[1].matchAll(/-\s*(.+)/g)].map((x) => x[1].trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  };
  return { fm, body, grab, list };
}

function metrics(file) {
  const { body, grab, list } = parse(file);
  const text = body.replace(/<[^>]+>/g, ' ').replace(/[#*_`>\-|]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const h2 = (body.match(/^##\s/gm) || []).length + (body.match(/<h2[\s>]/gi) || []).length;
  const faq = list('faq').length || (body.match(/<h3[\s>]/gi) || []).length;
  const image = Boolean(grab('image') || grab('cover') || /<img[\s>]/i.test(body));
  const related = list('related');
  const desc = grab('description');
  const title = grab('title');
  const money = MONEY_PAGES.some((m) => body.includes(m.url.split('#')[0]) && m.url !== '/');
  const outLinks = [...body.matchAll(/\/blog\/([a-z0-9-]+)\/?/gi)].map((m) => m[1]);
  const score =
    Math.min(words / 900, 1) * SKOR_RULES.words +
    Math.min(h2 / 3, 1) * SKOR_RULES.h2 +
    Math.min(faq / 5, 1) * SKOR_RULES.faq +
    (image ? SKOR_RULES.image : 0) +
    Math.min(related.length / 3, 1) * SKOR_RULES.related +
    (money ? SKOR_RULES.money : 0) +
    (title ? 2.5 : 0) + (desc ? 2.5 : 0);
  return { words, h2, faq, image, related, money, title, desc, outLinks, score: Math.round(score) };
}

/** Inventaris artikel tayang + metrik kualitas. */
export function inventory() {
  const live = posts().filter((p) => p.live);
  const articles = live.map((p) => {
    let m;
    try { m = metrics(p.file); } catch { m = { words: 0, h2: 0, faq: 0, image: false, related: [], money: false, title: p.title, desc: null, outLinks: [], score: 0 }; }
    return { slug: p.slug, title: p.title, date: p.date, updated: p.updated, ...m };
  });
  return { published: articles };
}

/** Graf internal link + yatim (0 inbound dari related/body artikel lain). */
export function linkGraph(articles) {
  const slugs = new Set(articles.map((a) => a.slug));
  const inbound = Object.fromEntries(articles.map((a) => [a.slug, 0]));
  let edges = 0;
  for (const a of articles) {
    const targets = new Set([...a.related, ...a.outLinks].filter((s) => slugs.has(s) && s !== a.slug));
    for (const t of targets) { inbound[t]++; edges++; }
  }
  const orphans = articles.filter((a) => inbound[a.slug] === 0).map((a) => ({ slug: a.slug, title: a.title, score: a.score }));
  return { edges, inbound, orphans, avgOut: articles.length ? Math.round((edges / articles.length) * 10) / 10 : 0 };
}

/** Funnel produksi dari snapshot collect(): keyword → antrean → draft → terbit → terindeks. */
export function funnel(d) {
  const q = d.queue?.counts || {};
  const s = d.summary || {};
  return [
    { stage: 'Keyword disetujui', value: d.keywords?.approved ?? null },
    { stage: 'Antrean (pending)', value: q.pending ?? null },
    { stage: 'Draft siap', value: q.draft ?? null },
    { stage: 'URL tayang', value: s.total ?? null },
    { stage: 'Terindeks (terukur)', value: s.measured ? (s.labels?.indexed ?? 0) : null },
  ];
}

/** Snapshot lengkap untuk halaman /tracking. */
export function buildTracking(d) {
  const inv = inventory();
  const articles = inv.published;
  const graph = linkGraph(articles);
  const scores = articles.map((a) => a.score);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const buckets = { tinggi: 0, sedang: 0, rendah: 0 };
  for (const s of scores) {
    if (s >= 80) buckets.tinggi++;
    else if (s >= 55) buckets.sedang++;
    else buckets.rendah++;
  }
  const thin = articles.filter((a) => a.words < 900).map((a) => ({ slug: a.slug, title: a.title, words: a.words, score: a.score }));
  return {
    generatedAt: new Date().toISOString(),
    total: articles.length,
    avgScore: avg,
    buckets,
    graph,
    funnel: funnel(d),
    thin,
    articles: articles.slice().sort((a, b) => a.score - b.score),
  };
}
