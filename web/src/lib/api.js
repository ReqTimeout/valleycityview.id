// web/src/lib/api.js — klien JSON tipis ke server zero-dep.
export async function fetchSnapshot() {
  const r = await fetch('/api/data', { headers: { Accept: 'application/json' } });
  if (r.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function postAction(action) {
  const r = await fetch(action, { method: 'POST', headers: { Accept: 'application/json' } });
  if (r.status === 401) { location.href = '/login'; return { ok: false, msg: 'Sesi berakhir — masuk lagi.' }; }
  try { return await r.json(); } catch { return { ok: r.ok }; }
}