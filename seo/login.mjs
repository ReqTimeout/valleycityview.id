/**
 * seo/login.mjs — halaman login dashboard Valley City SEO.
 * Brand lockup mark gunung + kartu form + shake saat error + toggle password +
 * caps-lock hint. Sesi HMAC HttpOnly; halaman noindex + no-referrer.
 */
import { icon } from '../runner/lib/icons.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="17.5" cy="6" r="2.1"/><path d="M2 20h20"/><path d="M3 20 9.2 8.5l3.3 5.6"/><path d="M10.5 20 15.5 11l6 9"/></svg>';

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('vcv-theme');var d=t?t==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export function renderLogin({ error = null } = {}) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>Masuk · Valley City SEO</title>
<link rel="icon" href="/assets/brand.svg">
<link rel="stylesheet" href="/assets/dashboard.css">
<script>${THEME_SCRIPT}</script>
</head>
<body>
<div class="auth-shell">
  <div class="auth-backdrop" aria-hidden="true"></div>
  <div class="auth-inner">
    <div class="brand-lockup">
      <span class="brand-mark">${MARK}</span>
      <div>
        <div class="brand-title">Valley City<span class="accent"> · SEO</span></div>
        <p class="brand-sub">Dashboard runner internal untuk <strong>valleycityview.id</strong><br>akses terbatas · bukan halaman publik</p>
      </div>
    </div>

    ${error ? `<div class="auth-error" role="alert">${icon('alert', 17)}<div>${esc(error)}</div></div>` : ''}

    <form class="auth-card${error ? ' form-shake' : ''}" method="POST" action="/login" autocomplete="on">
      <label class="field">
        <span class="field-label">Username</span>
        <div class="field-wrap">
          <input class="input" type="text" name="username" id="username" required autocomplete="username" placeholder="username" autofocus>
        </div>
      </label>
      <label class="field">
        <span class="field-label">Password</span>
        <div class="field-wrap">
          <input class="input has-toggle" type="password" name="password" id="password" required autocomplete="current-password" placeholder="••••••••">
          <button class="toggle-btn" type="button" id="toggle-pass" aria-label="Tampilkan password" aria-pressed="false">${icon('eye', 18)}</button>
        </div>
        <p id="caps-hint" class="auth-error" style="display:none;margin-top:.6rem">${icon('alert', 13)} Caps Lock aktif</p>
      </label>
      <button class="btn gold" type="submit" id="submit-btn"><span>Masuk ke Dashboard</span><span class="btn-arrow">${icon('arrow_right', 15)}</span></button>
    </form>

    <p class="auth-hint">Sesi HMAC HttpOnly · <code>noindex</code> · <a href="/healthz">health</a></p>
  </div>
</div>
<script>
(function(){
  var pass=document.getElementById('password'),btn=document.getElementById('toggle-pass'),hint=document.getElementById('caps-hint'),form=document.querySelector('form.auth-card'),submit=document.getElementById('submit-btn');
  var eye='${icon('eye', 18)}',eyeOff='${icon('eye_off', 18)}';
  btn.addEventListener('click',function(){var show=pass.type==='password';pass.type=show?'text':'password';btn.innerHTML=show?eyeOff:eye;btn.setAttribute('aria-pressed',String(show));btn.setAttribute('aria-label',show?'Sembunyikan password':'Tampilkan password');pass.focus();});
  function caps(e){hint.style.display=(e.getModifierState&&e.getModifierState('CapsLock'))?'flex':'none';}
  pass.addEventListener('keydown',caps);pass.addEventListener('keyup',caps);pass.addEventListener('blur',function(){hint.style.display='none';});
  form.addEventListener('submit',function(){submit.disabled=true;submit.innerHTML='<span>Memverifikasi…</span>';});
})();
</script>
</body>
</html>`;
}
