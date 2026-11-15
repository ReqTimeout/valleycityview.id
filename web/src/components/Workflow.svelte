<script>
  // Progres kerja otomatis dari atas ke bawah, memakai angka nyata snapshot.
  // Tahap yang belum pernah terjadi ditulis "belum ada data" — bukan 0 palsu.
  import { num, ago } from '../lib/format.js';
  import Chip from './Chip.svelte';

  let { snapshot = null } = $props();

  const d = $derived(snapshot);
  const queue = $derived(d?.queue?.counts || {});
  const totalPlan = $derived(d?.queue?.total || 0);
  const written = $derived((queue.published || 0) + (queue.draft || 0));
  const schedule = $derived(d?.schedule || {});
  const nowHourJakarta = $derived.by(() => {
    // Jendela tayang dinyatakan dalam waktu Jakarta (WIB, UTC+7).
    return new Date().getUTCHours() + 7;
  });
  const inWindow = $derived(
    schedule.startHour != null && schedule.endHour != null
      ? nowHourJakarta >= schedule.startHour && nowHourJakarta < schedule.endHour
      : null
  );
  const todayKey = $derived(new Date().toISOString().slice(0, 10));
  const runsToday = $derived.by(() => {
    const list = (d?.runs || []).filter((r) => typeof r?.at === 'string' && r.at.startsWith(todayKey));
    return {
      generated: list.filter((r) => r.kind === 'generate' && r.exit === 0).length,
      published: list.filter((r) => r.kind === 'publish' && r.exit === 0).length,
      any: list.length,
    };
  });
  const lastBing = $derived(d?.bing || null);
  const lastInspect = $derived(d?.summary?.lastInspect || null);
  const measured = $derived(d?.summary?.measured ?? null);
  const indexed = $derived(d?.summary?.labels?.indexed ?? null);
  const indexRate = $derived(d?.summary?.indexRate ?? null);

  const writtenPct = $derived(totalPlan ? Math.min(written / totalPlan, 1) : 0);

  const stages = $derived.by(() => {
    const halt = schedule.halt;
    const s = [];
    // 1 — Tulis
    s.push({
      n: 1,
      title: 'Tulis artikel',
      done: written,
      total: totalPlan,
      pct: writtenPct,
      value: totalPlan ? `${num(written)} dari ${num(totalPlan)} artikel` : 'belum ada data',
      note: totalPlan ? `${num(queue.pending || 0)} masih menunggu dibuat` : 'belum ada rencana artikel',
      state: queue.pending > 0 ? 'work' : 'done',
      chip: queue.pending > 0 ? { label: 'berjalan', kind: 'info' } : { label: 'lengkap', kind: 'ok' },
    });
    // 2 — Tayang per jadwal
    const winText = schedule.startHour != null
      ? `jendela ${String(schedule.startHour).padStart(2, '0')}.00–${String(schedule.endHour).padStart(2, '0')}.00 WIB`
      : 'jendela belum disetel';
    const quotaText = schedule.dailyCount != null ? `${num(schedule.dailyCount)} artikel/hari` : 'kuota belum disetel';
    s.push({
      n: 2,
      title: 'Tayangkan sesuai jadwal',
      value: quotaText,
      note: halt
        ? 'publikasi dijeda sementara oleh penyetelan'
        : `${winText} · hari ini ${runsToday.published}x tayang diperintahkan`,
      state: halt ? 'warn' : runsToday.published > 0 ? 'done' : 'work',
      chip: halt
        ? { label: 'dijeda', kind: 'warn' }
        : inWindow == null
          ? { label: '—', kind: 'info' }
          : inWindow
            ? { label: 'jendela terbuka', kind: 'ok' }
            : { label: 'menunggu jendela', kind: 'info' },
    });
    // 3 — Kirim ke Google & Bing
    const bingOk = lastBing?.ok === true;
    s.push({
      n: 3,
      title: 'Kirim alamat baru ke Google & Bing',
      value: `${num(d?.indexnow?.submitted ?? 0)} alamat terkirim`,
      note: lastBing?.at
        ? `${bingOk ? 'terakhir sukses' : 'terakhir bermasalah'} ke Bing ${ago(lastBing.at)}`
        : 'belum pernah mengirim ke Bing',
      state: (d?.indexnow?.submitted ?? 0) > 0 ? 'done' : 'work',
      chip: lastBing?.at ? (bingOk ? { label: 'sehat', kind: 'ok' } : { label: 'perlu cek', kind: 'warn' }) : { label: 'belum jalan', kind: 'info' },
    });
    // 4 — Periksa di Google
    s.push({
      n: 4,
      title: 'Periksa status di Google',
      value: measured != null ? `${num(measured)} alamat diperiksa` : 'belum ada pemeriksaan',
      note: lastInspect ? `pemeriksaan terakhir ${ago(lastInspect)}` : 'pemeriksaan berjalan otomatis tiap pagi',
      state: measured ? 'done' : 'work',
      chip: lastInspect ? { label: 'berjalan', kind: 'ok' } : { label: 'menunggu', kind: 'info' },
    });
    // 5 — Hasil pencarian
    s.push({
      n: 5,
      title: 'Muncul di hasil pencarian',
      value: indexed != null && measured ? `${num(indexed)} dari ${num(measured)} alamat` : 'belum diukur',
      note:
        indexRate != null
          ? `${(indexRate * 100).toFixed(1)}% dari yang diperiksa sudah masuk pencarian Google`
          : 'akan terisi setelah pemeriksaan Google pertama',
      state: indexRate != null ? (indexRate >= 0.5 ? 'done' : 'work') : 'work',
      chip: indexRate == null ? { label: 'belum diukur', kind: 'info' } : indexRate >= 0.5 ? { label: 'baik', kind: 'ok' } : { label: 'tumbuh', kind: 'info' },
    });
    return s;
  });
</script>

<div class="wf">
  {#each stages as st (st.n)}
    <div class="stage">
      <div class="rail {st.state}"><span class="dot"></span>{#if st.n < stages.length}<span class="line"></span>{/if}</div>
      <div class="body">
        <div class="head">
          <b>{st.n}. {st.title}</b>
          <span class="val">{st.value}</span>
          <Chip value={st.chip.label} label={st.chip.label} kind={st.chip.kind} />
        </div>
        <div class="note">{st.note}</div>
        {#if st.pct != null && st.total}
          <div class="bar"><span style="width:{Math.round(st.pct * 100)}%"></span></div>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .wf { display: flex; flex-direction: column; }
  .stage { display: flex; gap: 12px; }
  .rail { display: flex; flex-direction: column; align-items: center; width: 18px; flex: none; padding-top: 5px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ink-4); flex: none; }
  .line { width: 2px; flex: 1; background: var(--line); margin-top: 4px; min-height: 22px; }
  .stage.done .dot { background: var(--ok); }
  .stage.work .dot { background: var(--gold); }
  .stage.warn .dot { background: var(--warn); }
  .stage.done .line { background: var(--ok); opacity: .45; }
  .body { flex: 1; min-width: 0; padding-bottom: 14px; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .head b { font-size: 13.5px; }
  .val { font-size: 12.5px; color: var(--ink-2); font-weight: 600; }
  .note { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
  .bar { margin-top: 7px; height: 6px; border-radius: 4px; background: var(--surface-2); overflow: hidden; max-width: 420px; }
  .bar span { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--gold), var(--ok)); transition: width .5s ease; }
</style>
