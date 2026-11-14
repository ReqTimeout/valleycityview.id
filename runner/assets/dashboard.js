/* runner/assets/dashboard.js — enhancement klien (tanpa dependency).
   Data tetap server-rendered; JS hanya: tema, drawer mobile, toast ?msg=,
   count-up KPI numerik. Semua degrade graceful bila JS mati. */
(function () {
  'use strict';
  var root = document.documentElement;
  var SUN = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var MOON = '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function paintTheme() {
    var dark = root.classList.contains('dark');
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.innerHTML = dark ? SUN : MOON;
      b.setAttribute('aria-label', dark ? 'Mode terang' : 'Mode gelap');
    });
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var dark = !root.classList.contains('dark');
      root.classList.toggle('dark', dark);
      try { localStorage.setItem('vcv-theme', dark ? 'dark' : 'light'); } catch (e) {}
      paintTheme();
    });
  });
  paintTheme();

  /* Drawer mobile */
  function closeDrawer() { document.body.classList.remove('drawer-open'); }
  document.querySelectorAll('[data-drawer-open]').forEach(function (b) {
    b.addEventListener('click', function () { document.body.classList.add('drawer-open'); });
  });
  document.querySelectorAll('[data-drawer-close], .scrim').forEach(function (b) {
    b.addEventListener('click', closeDrawer);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  /* Toast dari ?msg= (hasil mutasi), lalu bersihkan URL */
  try {
    var u = new URL(location.href);
    var msg = u.searchParams.get('msg');
    if (msg) {
      var host = document.querySelector('.toast-host');
      if (host) {
        var t = document.createElement('div');
        t.className = 'toast';
        t.setAttribute('role', 'status');
        t.innerHTML = '<svg class="ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span></span>';
        t.querySelector('span').textContent = msg;
        host.appendChild(t);
        setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(function () { t.remove(); }, 400); }, 5200);
      }
      u.searchParams.delete('msg');
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : ''));
    }
  } catch (e) {}

  /* Count-up hanya untuk .kpi .v yang teksnya angka murni */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    document.querySelectorAll('.kpi .v').forEach(function (el) {
      var raw = el.textContent.trim().replace(/\./g, '').replace(/,/g, '.');
      if (!/^\d+(\.\d+)?$/.test(raw)) return;
      var target = parseFloat(raw);
      if (!isFinite(target) || target === 0) return;
      var suffix = el.textContent.trim().replace(/^[\d.,]+/, '');
      var start = null, dur = 700;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = Math.round(target * eased);
        el.textContent = val.toLocaleString('id-ID') + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
})();
