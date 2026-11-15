<script>
  import { data } from '../lib/state.svelte.js';
  import { num, ago } from '../lib/format.js';
  import PageHead from '../components/PageHead.svelte';
  import Icon from '../components/Icon.svelte';

  const d = $derived(data.snapshot);
  const creds = $derived(d?.credentials || []);
  const sm = $derived(d?.sitemap || {});
  const isSet = (env) => Boolean(creds.find((c) => c.env === env)?.set);

  const services = $derived([
    { key: 'publish', label: 'Publikasi ke situs', desc: 'Artikel baru tayang otomatis di website Anda', icon: 'up', hue: 'teal', ok: isSet('GITHUB_TOKEN') && isSet('CLOUDFLARE_API_TOKEN') && isSet('CLOUDFLARE_ACCOUNT_ID') },
    { key: 'writer', label: 'Penulis artikel (Qwen)', desc: 'Menulis draf baru tiap hari dari antrean kata kunci', icon: 'file', hue: 'forest', ok: isSet('QWEN_API_KEY') },
    { key: 'google', label: 'Koneksi Google', desc: 'Memeriksa apakah artikel sudah muncul di Google', icon: 'search', hue: 'sky', ok: isSet('GSC_SERVICE_ACCOUNT_JSON_B64') },
    { key: 'bing', label: 'Kirim ke Bing', desc: 'Memberi tahu Bing setiap ada artikel baru', icon: 'globe', hue: 'plum', ok: isSet('BING_API_KEY') },
    { key: 'email', label: 'Laporan email', desc: 'Ringkasan hasil dikirim ke email Anda', icon: 'bell', hue: 'gold', ok: isSet('RESEND_API_KEY') && isSet('NOTIFY_EMAIL_TO'), optional: true },
  ]);
  const coreOk = $derived(services.filter((s) => !s.optional).every((s) => s.ok));
  const connected = $derived(services.filter((s) => s.ok).length);
  const healthy = $derived(coreOk && Boolean(d?.auth));

  const hero = $derived(
    healthy
      ? { tone: 'ok', icon: 'shield', title: 'Semua sistem berjalan normal', sub: 'Mesin menulis, menayangkan, dan memeriksa artikel Anda secara otomatis. Anda tidak perlu memantau apa pun.' }
      : coreOk
        ? { tone: 'warn', icon: 'shield', title: 'Sistem utama berjalan normal', sub: 'Satu hal kecil: aktifkan login agar dashboard ini hanya bisa dibuka oleh Anda.' }
        : { tone: 'warn', icon: 'alert', title: 'Ada layanan yang belum terhubung', sub: 'Sebagian pekerjaan otomatis belum bisa berjalan sampai layanan di bawah terhubung.' }
  );
</script>

<PageHead title="Status Sistem" sub="Kondisi mesin SEO Anda secara ringkas — tanpa istilah teknis" />

<section class="hero {hero.tone} reveal" style="--i:0">
  <div class="hero-glow" aria-hidden="true"></div>
  <div class="emblem {hero.tone}">
    <span class="ring" aria-hidden="true"></span>
    <Icon name={hero.icon} size={30} />
  </div>
  <div class="hero-text">
    <h2>{hero.title}</h2>
    <p>{hero.sub}</p>
    <div class="hero-meta">
      <span class="pill">{connected} dari {services.length} layanan terhubung</span>
      <span class="upd">Diperbarui {ago(d?.generatedAt)}</span>
    </div>
  </div>
</section>

<div class="svc-grid">
  {#each services as s, i (s.key)}
    <article class="svc reveal {s.ok ? 'on' : 'off'}" style="--i:{i + 1}; --hue:var(--{s.hue})">
      <div class="medal"><Icon name={s.icon} size={20} /></div>
      <div class="svc-body">
        <div class="svc-top">
          <h3>{s.label}</h3>
          {#if s.optional}<span class="opt">opsional</span>{/if}
          <span class="state {s.ok ? 'ok' : 'warn'}">
            <Icon name={s.ok ? 'check' : 'alert'} size={13} />
            {s.ok ? 'Terhubung' : 'Belum'}
          </span>
        </div>
        <p>{s.desc}</p>
      </div>
    </article>
  {/each}
</div>

<div class="info-strip reveal" style="--i:5">
  <div class="info">
    <span class="ii {d?.auth ? 'ok' : 'warn'}"><Icon name="shield" size={16} /></span>
    <div><b>Login dashboard</b><span>{d?.auth ? 'Aktif — hanya Anda yang bisa membuka halaman ini' : 'Belum aktif — sebaiknya segera diaktifkan'}</span></div>
  </div>
  <div class="info">
    <span class="ii {sm.exists ? 'ok' : 'warn'}"><Icon name="globe" size={16} /></span>
    <div><b>Daftar alamat untuk Google</b><span>{sm.exists ? num(sm.urls) + ' alamat · diperbarui ' + (sm.ageHours == null ? '—' : num(Math.round(sm.ageHours)) + ' jam') + ' lalu' : 'Belum tersedia'}</span></div>
  </div>
</div>

<style>
  .hero { position: relative; display: flex; align-items: center; gap: 22px; padding: 26px 28px; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--line); color: var(--forest-ink); background: linear-gradient(120deg, var(--forest) 0%, var(--forest-2) 55%, var(--forest-3) 100%); box-shadow: var(--shadow-lg); }
  .hero.warn { background: linear-gradient(120deg, #3a2f12 0%, #4a3a14 60%, #5a4718 100%); }
  .hero-glow { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(420px 200px at 88% -20%, rgba(201, 162, 39, .28), transparent 70%), radial-gradient(360px 220px at 8% 120%, rgba(31, 122, 109, .35), transparent 70%); }
  .emblem { position: relative; flex: 0 0 auto; width: 68px; height: 68px; display: grid; place-items: center; border-radius: 50%; color: var(--forest-ink); background: rgba(255, 255, 255, .1); border: 1px solid rgba(255, 255, 255, .22); }
  .emblem.ok { color: #bfe9d2; }
  .emblem.warn { color: #f3dca0; }
  .emblem .ring { position: absolute; inset: -6px; border-radius: 50%; border: 2px solid currentColor; opacity: .35; animation: pulse 2.6s var(--ease) infinite; }
  .emblem.warn .ring { animation: none; opacity: .2; }
  @keyframes pulse { 0% { transform: scale(.92); opacity: .4; } 70% { transform: scale(1.12); opacity: 0; } 100% { opacity: 0; } }
  .hero-text { position: relative; min-width: 0; }
  .hero-text h2 { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -.01em; }
  .hero-text p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--forest-ink-2); max-width: 60ch; }
  .hero-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 14px; }
  .pill { font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; background: rgba(255, 255, 255, .12); border: 1px solid rgba(255, 255, 255, .2); }
  .upd { font-size: 12px; color: var(--forest-ink-2); }

  .svc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
  .svc { position: relative; display: flex; align-items: flex-start; gap: 14px; padding: 18px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); transition: transform .25s var(--ease), box-shadow .25s var(--ease), border-color .25s var(--ease); }
  .svc::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; border-radius: 3px; background: var(--hue); opacity: .85; }
  .svc:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); border-color: var(--line-2); }
  .medal { flex: 0 0 auto; width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; color: var(--hue); background: color-mix(in srgb, var(--hue) 14%, transparent); }
  .svc-body { min-width: 0; flex: 1; }
  .svc-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .svc-top h3 { margin: 0; font-size: 14.5px; font-weight: 700; }
  .opt { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-3); background: var(--surface-3); padding: 2px 7px; border-radius: 999px; }
  .svc-body p { margin: 5px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-3); }
  .state { margin-left: auto; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 999px; }
  .state.ok { color: var(--ok); background: var(--ok-soft); }
  .state.warn { color: var(--warn); background: var(--warn-soft); }

  .info-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
  .info { display: flex; align-items: center; gap: 13px; padding: 15px 18px; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius); }
  .ii { flex: 0 0 auto; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; }
  .ii.ok { color: var(--ok); background: var(--ok-soft); }
  .ii.warn { color: var(--warn); background: var(--warn-soft); }
  .info b { display: block; font-size: 13px; }
  .info span { display: block; font-size: 12px; color: var(--ink-3); margin-top: 2px; }

  @media (max-width: 720px) {
    .hero { flex-direction: column; align-items: flex-start; gap: 16px; padding: 22px; }
    .svc-grid, .info-strip { grid-template-columns: 1fr; }
    .svc { padding: 16px; }
  }
</style>
