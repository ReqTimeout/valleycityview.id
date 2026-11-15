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
    { key: 'path', label: 'Catatan', get: (r) => r.path },
    { key: 'mtime', label: 'Ditulis', sortable: true, get: (r) => (r.mtime ? ago(r.mtime) : '—') },
    { key: 'note', label: 'Isi', get: (r) => r.note },
  ];
  const accessTone = $derived({ enforced: 'ok', 'enforce-off': 'warn', 'not-configured': 'bad', unknown: 'warn' }[access.mode] || 'warn');
</script>

<PageHead title="Kesehatan" sub="Kondisi mesin: koneksi, daftar alamat untuk Google, pencatatan, dan proteksi akses" />

<div class="grid g4">
  <Kpi i={0} label="Koneksi terpasang" value="{setCount}/{creds.length}" tone={setCount === creds.length ? 'ok' : 'warn'} />
  <Kpi i={1} label="Daftar alamat (sitemap)" value={sm.exists ? num(sm.urls) + ' alamat' : 'belum ada'} tone={sm.exists ? 'teal' : 'bad'} note={sm.exists ? 'diperbarui ' + (sm.ageHours == null ? '—' : num(Math.round(sm.ageHours)) + ' jam') + ' lalu' : 'Google belum punya daftar alamat'} />
  <Kpi i={2} label="Berkas pencatatan" value={files.length} />
  <Kpi i={3} label="Status proses" value={lock ? (lock.corrupt ? 'masalah' : 'sedang bekerja') : 'siap'} tone={lock ? (lock.corrupt ? 'bad' : 'warn') : 'ok'} />
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={4} title="Koneksi ke layanan luar" sub="status nyata — tanpa memperlihatkan isi rahasia">
    <div class="cred-list">
      {#each creds as c (c.env)}
        <div class="cred-row">
          <Chip value={c.set ? 'set' : 'kosong'} label={c.set ? 'terhubung' : 'belum terpasang'} kind={c.set ? 'ok' : 'warn'} />
          <div class="cred-meta"><b>{c.role}</b><span>{c.env} · dipakai untuk {c.neededBy}</span></div>
        </div>
      {/each}
    </div>
  </Card>
  <Card i={5} title="Daftar alamat & proteksi">
    <dl class="kv">
      <dt>Daftar alamat untuk Google</dt><dd>{sm.exists ? 'Ada' : 'Belum ada'}</dd>
      <dt>Alamat terbaru tercatat</dt><dd>{sm.newest ? date(sm.newest) : '—'}</dd>
      <dt>Kunci kirim cepat</dt><dd>{d?.indexnowKey?.exists ? 'Ada' : 'Belum ada'} · <a href={d?.indexnowKey?.servedAt} target="_blank" rel="noopener">buka bukti ↗</a></dd>
      <dt>Hasil build situs</dt><dd>{d?.distExists ? 'Ada' : 'Belum ada'}</dd>
    </dl>
    {#if d?.auth}
      <div class="callout ok" style="margin-top:10px"><b>Login aktif</b> — dashboard hanya bisa dibuka setelah login (sebagai {d?.user || '—'}). Ini pelindung utama.</div>
    {:else}
      <div class="callout bad" style="margin-top:10px"><b>Login belum aktif</b> — dashboard terbuka tanpa kata sandi. Segera aktifkan login dashboard.</div>
    {/if}
    <div class="callout {accessTone}" style="margin-top:8px"><b>Pelindung ekstra (Cloudflare Access): {access.label || access.mode}</b><br />{access.note}</div>
    {#if lock && !lock.corrupt}<div class="callout warn" style="margin-top:8px">Mesin sedang mengerjakan sesuatu sejak {ago(lock.at)} — tunggu sampai selesai sebelum menjalankan aksi lain.</div>{/if}
    {#if lock?.corrupt}<div class="callout bad" style="margin-top:8px">Berkas kunci proses rusak — mesin mungkin tidak bisa menjalankan pekerjaan sampai dibersihkan.</div>{/if}
  </Card>
</div>

<h2 class="sec">Berkas pencatatan mesin</h2>
<DataTable columns={fileCols} rows={files} searchKeys={['path', 'note']} placeholder="Cari catatan…" />

<style>
  .cred-list { display: flex; flex-direction: column; gap: 8px; }
  .cred-row { display: flex; align-items: center; gap: 10px; }
  .cred-meta { display: flex; flex-direction: column; min-width: 0; }
  .cred-meta b { font-size: 13px; }
  .cred-meta span { font-size: 11.5px; color: var(--ink-3); font-family: var(--mono); }
</style>
