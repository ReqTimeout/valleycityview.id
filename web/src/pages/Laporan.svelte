<script>
  import { data } from '../lib/state.svelte.js';
  import { num, ago, date } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Kpi from '../components/Kpi.svelte';
  import Card from '../components/Card.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Chip from '../components/Chip.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const d = $derived(data.snapshot);
  const reports = $derived(d?.reports || []);
  const env = $derived(d?.reportsEnv || {});

  const kindLabel = (k) => ({ harian: 'Harian', mingguan: 'Mingguan', watchdog: 'Pengawas', rank: 'Ranking', alerts: 'Peringatan', uji: 'Uji' }[k] || k || '—');

  const cols = [
    { key: 'at', label: 'Waktu', sortable: true, get: (r) => `${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(r.at))} WIB` },
    { key: 'kind', label: 'Jenis', get: (r) => kindLabel(r.kind) },
    { key: 'sent', label: 'Status', chip: (r) => (r.sent
      ? { value: 'sent', label: 'terkirim', kind: 'ok' }
      : { value: 'failed', label: r.reason === 'not-configured' ? 'belum terkonfigurasi' : 'gagal', kind: r.reason === 'not-configured' ? 'warn' : 'bad' }) },
    { key: 'to', label: 'Penerima', get: (r) => [(r.to || []).join(', '), (r.cc || []).length ? `cc: ${r.cc.join(', ')}` : ''].filter(Boolean).join(' · ') || '—' },
    { key: 'subject', label: 'Subjek', sortable: true, get: (r) => String(r.subject || '').slice(0, 90) },
  ];
</script>

<PageHead title="Laporan" sub="Riwayat laporan otomatis ke klien + jadwal pengiriman">
  <Chip value={env.configured ? 'on' : 'off'} kind={env.configured ? 'ok' : 'warn'} label={env.configured ? 'pengiriman aktif' : 'belum terkonfigurasi'} />
</PageHead>

<div class="grid g4">
  <Kpi i={0} label="Laporan terkirim" value={reports.filter((r) => r.sent).length} note="{num(reports.length)} total riwayat" tone={reports.filter((r) => r.sent).length ? 'ok' : ''} />
  <Kpi i={1} label="Laporan terakhir" value={reports[0] ? ago(reports[0].at) : '—'} note={reports[0] ? kindLabel(reports[0].kind) : 'belum pernah terkirim'} />
  <Kpi i={2} label="Penerima" value={env.to || '—'} note={env.cc ? `klien cc: ${env.cc}` : env.configured ? 'tujuan laporan' : 'NOTIFY_EMAIL belum di-set'} />
  <Kpi i={3} label="Jadwal harian" value={env.dailyAt || '—'} note={env.from ? `dari ${env.from}` : 'pengirim belum di-set'} tone="info" />
</div>

<div style="margin-top:14px">
  <Card i={4} title="Riwayat laporan terkirim" sub="Harian (klien) & mingguan (ringkasan performa)">
    {#if reports.length}
      <DataTable columns={cols} rows={reports} searchKeys={['subject', 'kind', 'to']} placeholder="Cari laporan…" />
    {:else}
      <EmptyState icon="inbox" title="Belum ada laporan tercatat" note="Laporan harian dikirim otomatis jam {env.dailyAt || '06:00'} WIB setelah mesin harian selesai — rekamannya muncul di sini." />
    {/if}
    {#if !env.configured}
      <div class="callout warn" style="margin-top:12px">Pengiriman email belum aktif: RESEND_API_KEY / NOTIFY_EMAIL_TO / NOTIFY_EMAIL_FROM belum lengkap. Laporan tetap dicatat sebagai "belum terkonfigurasi" supaya tidak ada riwayat palsu.</div>
    {/if}
  </Card>
</div>

<div class="grid g2" style="margin-top:14px">
  <Card i={5} title="Cara kerja laporan">
    <ul class="li">
      <li><b>Harian</b> — dikirim tiap pagi setelah siklus mesin (penulisan + pemeriksaan Google) selesai.</li>
      <li><b>Mingguan</b> — ringkasan performa tiap Senin pagi.</li>
      <li><b>Pengawas</b> — peringatan otomatis bila mesin mendeteksi masalah (dikirim kapan pun masalah ditemukan).</li>
    </ul>
  </Card>
  <Card i={6} title="Status konfigurasi">
    <dl class="kv">
      <dt>Kirim email</dt><dd>{env.configured ? 'Aktif' : 'Belum aktif'}</dd>
      <dt>Tujuan</dt><dd>{env.to || '—'}</dd>
      <dt>Klien (cc)</dt><dd>{env.cc || '—'}</dd>
      <dt>Pengirim</dt><dd>{env.from || '—'}</dd>
      <dt>Jadwal harian</dt><dd>{env.dailyAt || '—'} (task harian di Coolify)</dd>
    </dl>
  </Card>
</div>

<style>
  .li { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.7; color: var(--ink-2); }
  .li b { color: var(--ink); }
</style>
