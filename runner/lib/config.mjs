/**
 * runner/lib/config.mjs — konfigurasi terpusat dashboard+runner (dari env).
 *
 * Tidak ada nilai default yang sensitif. Env kosong → fitur terkait degrade
 * graceful (dashboard menulis "belum dikonfigurasi"), bukan crash. Path state
 * mengikuti seo/paths.mjs (env SEO_*); di container di-mount ke /app/data.
 */
import { existsSync } from 'node:fs';
import { GSC_SITE_URL, NOTIFY_PREFIX, CF_PROJECT } from '../../seo/site.mjs';

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const CFG = {
  siteHost: process.env.SITE_HOSTNAME || 'valleycityview.id',
  dashboardHost: process.env.DASHBOARD_HOSTNAME || 'valleycity.beriklan.co.id',
  siteUrl: process.env.SITE_ORIGIN || 'https://valleycityview.id',
  port: int(process.env.PORT, 8080),
  tz: process.env.TZ || 'Asia/Jakarta',

  // Auth dashboard (kosong = terbuka; tetap noindex). Disarankan isi di Coolify.
  authUser: process.env.DASHBOARD_USER || '',
  authPass: process.env.DASHBOARD_PASS || '',

  // Batas generate per klik tombol dashboard (kuota aman, gerbang tetap jalan).
  generateCount: int(process.env.SEO_GENERATE_COUNT, 2),
  generateCountMax: int(process.env.SEO_GENERATE_COUNT_MAX, 10),
  // Backlog cap: tahan generate bila draft sudah menumpuk (GAP B1 / #19).
  backlogMax: int(process.env.SEO_BACKLOG_MAX, 16),

  // Identitas indexing/notifikasi (satu sumber di seo/site.mjs).
  gscSiteUrl: GSC_SITE_URL,
  notifyPrefix: NOTIFY_PREFIX,
  cfPagesProject: CF_PROJECT,

  // Jam jendela publish tick (WIB). Host TZ=UTC → cron diatur di Coolify.
  tickWindowStart: int(process.env.SEO_TICK_START, 9),
  tickWindowEnd: int(process.env.SEO_TICK_END, 16),

  // Ambang watchdog (jam).
  watchdogPublishMaxH: int(process.env.WATCHDOG_PUBLISH_H, 2),
  watchdogReportMaxH: int(process.env.WATCHDOG_REPORT_H, 30),
  watchdogRunMaxH: int(process.env.WATCHDOG_RUN_H, 6),

  // Rank tracking: alert bila posisi turun lebih dari ini (#19).
  rankDropAlert: int(process.env.SEO_RANK_DROP, 3),

  notifyWebhook: process.env.NOTIFY_WEBHOOK_URL || '',
  refreshMs: int(process.env.DASHBOARD_REFRESH_MS, 6 * 60 * 60 * 1000),
};

export const hasAuth = () => Boolean(CFG.authUser && CFG.authPass);

// Jalur publish aman-container: publish.mjs MENOLAK build di dalam container
// (insiden OOM 6 Okt). publish-git.mjs = flip+commit+push, build di Cloudflare
// Pages. Lokal (tanpa /.dockerenv) tetap publish.mjs untuk review manual.
export const inContainer = existsSync('/.dockerenv');
export const publishScript = inContainer ? 'seo/publish-git.mjs' : 'seo/publish.mjs';
