/**
 * seo/lib/summary.mjs — satu rumus untuk angka-angka yang dilaporkan.
 *
 * Kenapa modul ini ada: angka yang sama (index_rate, jumlah label, discovery
 * gap) dihitung di email harian, di laporan mingguan, dan di dashboard. Begitu
 * rumusnya disalin tiga kali, salah satunya pasti melengkung pelan-pelan dan
 * tidak ada yang tahu mana yang benar. Ini penerus langsung `buildSummary()`
 * yang dulu hidup sendiri di runner/daily.mjs.
 *
 * Yang diukur HANYA yang benar-benar punya hasil inspeksi. `unknown` (belum
 * pernah dicek) tidak dihitung sebagai kegagalan indeks — lihat
 * seo/ramp-gate.mjs, yang memisahkan `measured` dari `total` dengan alasan yang
 * sama.
 */

/** Label indeks per URL published: indexed | not_indexed | not_discovered | blocked | redirected | unknown. */
export function labelCounts(published) {
  return published.reduce((acc, p) => {
    const l = p.indexed || 'unknown';
    acc[l] = (acc[l] || 0) + 1;
    return acc;
  }, {});
}

export function indexRate(labels) {
  const discovered = (labels.indexed || 0) + (labels.not_indexed || 0) + (labels.blocked || 0);
  return discovered ? (labels.indexed || 0) / discovered : null;
}

/**
 * Ringkasan state.json untuk laporan apa pun.
 * @param {object} state isi seo/state.json
 * @returns {{total:number, labels:object, indexRate:number|null, measured:number,
 *            discoveryGap:number, lastInspect:string|null, bing:object|null,
 *            rampGate:object|null, alerts:array, indexer:object|null, dailyCount:number|null}}
 */
export function buildSummary(state = {}) {
  const published = state.published || [];
  const labels = labelCounts(published);
  const measured = (labels.indexed || 0) + (labels.not_indexed || 0) + (labels.blocked || 0);
  return {
    total: published.length,
    labels,
    indexRate: indexRate(labels),
    measured,
    discoveryGap: (labels.not_discovered || 0) + (labels.unknown || 0),
    lastInspect: state.gsc?.lastRun?.at || null,
    bing: state.bing?.lastRun || null,
    rampGate: state.rampGate?.lastRun || null,
    alerts: [state.rampGate?.alert, state.remedyAlert].filter(Boolean),
    indexer: state.indexer?.lastRun || null,
    // Diisi pemanggil: daily_count ada di config.json, bukan state.json.
    dailyCount: null,
  };
}

/** Teks index_rate yang jujur: belum ada pengukuran ≠ 0%. */
export function rateText(rate) {
  return rate === null ? 'belum diukur' : `${(rate * 100).toFixed(1)}%`;
}
