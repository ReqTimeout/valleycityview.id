<script>
  import { data } from '../lib/state.svelte.js';
  import { num, ago, date } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Chip from '../components/Chip.svelte';

  const d = $derived(data.snapshot);
  const creds = $derived(d?.credentials || []);
  const files = $derived(d?.files || []);
  const sm = $derived(d?.sitemap || {});
  const access = $derived(d?.access || {});
  const lock = $derived(d?.lock);
  const setCount = $derived(creds.filter((c) => c.set).length);

  const fileCols = [
    { key: 'path', label: 'Berkas state', get: (r) => r.path },
    { key: 'mtime', label: 'Ditulis', sortable: true, get: (r) => (r.mtime ? ago(r.mtime) : '—') },
    { key: 'note', label: 'Isi', get: (r) => r.note },
  ];
  const accessTone = $derived({ enforced: 'ok', 'enforce-off': 'warn', 'not-configured': 'bad', unknown: 'warn' }[access.mode] || 'warn');
</script>

<PageHead title="Health" sub="Kesehatan mesin: kredensial, sitemap, state, lock, dan proteksi akses" />

<div class="grid g4">
  <Kpi i={0} label="Kredensial terpasang" value="{setCount}/{creds.length}" tone={setCount === creds.length ? 'ok' : 'warn'} />
  <Kpi i={1} label="Umur sitemap" value={sm.ageHours == null ? '—' : num(Math.round(sm.ageHours)) + ' jam'} tone={sm.exists ? 'teal' : 'bad'} note="{num(sm.urls)} URL" />
  <Kpi i={2} label="Berkas state" value={files.length} />
  <Kpi i={3} label="Lock pipeline" value={lock ? (lock.corrupt ? 'korup' : 'aktif') : 'bebas'} tone={lock ? (lock.corrupt ? 'bad' : 'warn') : 'ok'} />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Kredensial environment" sub="ditampilkan apa adanya — tidak dikarang">
    <div class="cred-list">
      {#each creds as c (c.env)}
        <div class="cred-row">
          <Chip value={c.set ? 'set' : 'kosong'} label={c.set ? 'terpasang' : 'kosong'} kind={c.set ? 'ok' : 'warn'} />
          <div class="cred-meta"><b>{c.env}</b><span>{c.role} · {c.neededBy}</span></div>
        </div>
      {/each}
    </div>
  </Card>
  <Card i={5} title="Sitemap & proteksi">
    <dl class="kv">
      <dt>Sitemap ada</dt><dd>{sm.exists ? 'Ya' : 'Tidak'}</dd>
      <dt>URL / lastmod</dt><dd>{num(sm.urls)} / {num(sm.withLastmod)}</dd>
      <dt>Lastmod terbaru</dt><dd>{sm.newest ? date(sm.newest) : '—'}</dd>
      <dt>IndexNow key</dt><dd>{d?.indexnowKey?.exists ? 'Ada' : 'Tidak'} · <a href={d?.indexnowKey?.servedAt} target="_blank" rel="noopener">cek served ↗</a></dd>
      <dt>Dist situs</dt><dd>{d?.distExists ? 'Ada' : 'Tidak'}</dd>
    </dl>
    <div class="callout {accessTone}" style="margin-top:10px"><b>Access: {access.label || access.mode}</b><br />{access.note}</div>
    {#if lock && !lock.corrupt}<div class="callout warn" style="margin-top:8px">Lock dipegah {lock.host || '?'} (pid {lock.pid}) sejak {ago(lock.at)}.</div>{/if}
    {#if lock?.corrupt}<div class="callout bad" style="margin-top:8px">Berkas lock korup — periksa {lock.path}.</div>{/if}
  </Card>
</div>

<h2 class="sec">Berkas state mesin</h2>
<DataTable columns={fileCols} rows={files} searchKeys={['path', 'note']} placeholder="Cari berkas…" />

<style>
  .cred-list { display: flex; flex-direction: column; gap: 8px; }
  .cred-row { display: flex; align-items: center; gap: 10px; }
  .cred-meta { display: flex; flex-direction: column; min-width: 0; }
  .cred-meta b { font-size: 12.5px; font-family: var(--mono); }
  .cred-meta span { font-size: 11.5px; color: var(--ink-3); }
</style>