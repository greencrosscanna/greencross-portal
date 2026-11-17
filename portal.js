"use strict";
/* Green Cross staff portal — one sign-in, a Launch tile for every app you hold, and a plain
   green/yellow/red Status strip. All GX Core traffic goes through GXClient.

   The portal has no backend of its own. It signs in with login(user, pass, 'portal') — GX Core lets
   anyone with at least one app grant in — then asks two token-gated routes:
     my_apps        the apps this person holds (Command Center is listed for Sky only, server-side)
     portal_status  lights for Dutchie / Sales data / Inventory sync (+ QuickBooks for Shawn and admins)
   Nothing here decides who sees what: the server filters, this file only draws. */
(function () {
  var GXCORE_URL = 'https://script.google.com/macros/s/AKfycbx9mjeCBbDpxNYaqBv2hyZaO1hpbGG6PZM9AebFdwl0UwkdtRCGSWrH-8ohEtdF1K_6/exec';
  var VERSION = 'v1.107';
  window.PORTAL_VERSION = VERSION;
  var SESSION_KEY = 'portal_session';
  var STATUS_EVERY_MS = 60000;
  // The registry has no URL for Command Center (it is served by GX Core itself).
  var CC_FALLBACK_URL = GXCORE_URL;
  /* Sign in with Google (admins). The SAME string as GX_GOOGLE_CLIENT_ID in GX Core's gx_core.gs — Core
     checks every Google token's audience against its own copy, so a mismatch here fails closed (Core
     refuses with wrong_audience). Not a secret. Empty = the Google button is not shown at all. */
  var GOOGLE_CLIENT_ID = '929857310040-3nt8cnqags1n0bvpntokdnssiplvs4va.apps.googleusercontent.com';
  var GOOGLE_DOMAIN = 'greencrosscanna.com';

  var GX = GXClient(GXCORE_URL, { retries: 3 });
  var root = document.getElementById('app');
  var timer = null;
  var navHooked = false;

  /* Bug reporter (shared gx-bugreport.js). The portal has no backend, so it files straight to GX Core's
     token-gated file_bug route. The server forces app=portal and takes the reporter from the token —
     what is sent here for those is ignored on purpose. The shared form's field names (desc, priority,
     appVer) are mapped to the route's (detail, severity, app_version). No screenshot upload: the route
     takes none. fab:false — the trigger is the user-menu item, which only exists once signed in. */
  if (window.GXBugReport) {
    GXBugReport.init({
      app: 'portal',
      fab: false,
      version: function () { return VERSION; },
      context: function () { return { tab: 'portal' }; },
      submit: function (payload) {
        var s = getSession();
        if (!s) return Promise.resolve({ ok: false, error: 'Your session expired — sign in again, then report it.' });
        return GX.jsonp('file_bug', {
          token: s.token, title: payload.title, detail: payload.desc, severity: payload.priority,
          app_version: payload.appVer, context: payload.context,
        }, { retries: 1, timeoutMs: 20000 });
      },
    });
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // sessionStorage, like the other credentialed apps: closing the tab ends the session.
  // GX Core's login returns expiresAt as an ISO string (a number elsewhere in the suite), so accept
  // both. An expiry that parses to neither is treated as expired — fail closed.
  function expiryMs(v) {
    var n = Number(v);
    if (isFinite(n) && n > 0) return n;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  function getSession() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && (!s.expiresAt || expiryMs(s.expiresAt) > Date.now())) return s;
    } catch (e) {}
    return null;
  }
  function setSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function signOut() {
    clearSession();
    // Stop Google from silently picking the same account on the next visit to this sign-in screen.
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
    if (timer) { clearInterval(timer); timer = null; }
    renderGate('');
  }

  // ─── sign-in ────────────────────────────────────────────────────────────────────────────────
  function renderGate(errMsg) {
    document.body.classList.add('is-gated');
    var top = document.getElementById('topnav'); if (top) top.style.display = 'none';
    root.innerHTML =
      '<div class="gx-login"><div class="gx-login-card">' +
        '<div class="gx-login-head">' +
          '<img class="gx-login-mark" src="https://greencrosscanna.github.io/greencross-gx-theme/gx-logo.png" alt="Green Cross">' +
          '<div class="gx-login-sub">Apps</div>' +
        '</div>' +
        (GOOGLE_CLIENT_ID
          ? '<div class="pt-google"><div class="pt-google-h">Admins</div><div id="gBtn"></div>' +
            '<div class="gx-login-err" id="gErr"></div><div class="pt-or"><span>or</span></div></div>'
          : '') +
        '<form class="gx-login-form" id="gateForm">' +
          '<label class="gx-login-field"><span>Username</span>' +
            '<input class="gx-input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>' +
          '<label class="gx-login-field"><span>Password</span>' +
            '<input class="gx-input" id="gatePass" type="password" autocomplete="current-password" required></label>' +
          '<button type="submit" class="gx-btn gx-btn-green gx-login-submit">Sign in</button>' +
          '<div class="gx-login-err">' + esc(errMsg) + '</div>' +
        '</form>' +
      '</div></div>';
    var form = document.getElementById('gateForm');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('button'), err = form.querySelector('.gx-login-err');
      var u = document.getElementById('gateUser').value.trim();
      var pw = document.getElementById('gatePass').value;
      btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
      GX.getJSON('login', { user: u, pass: pw, app: 'portal' }, { retries: 2, timeoutMs: 20000 })
        .then(function (r) {
          // Branch on `code`, never on `error` (Core rewords prose; the code is the contract).
          if (r && r.code === 'no_access') throw new Error('Your account is not set up for any apps yet. Ask Sky to add you.');
          if (!r || !r.ok) throw new Error((r && r.error) || 'Sign-in failed');
          setSession({ user: r.user, name: r.displayName || r.user, role: r.role,
                       token: r.token, expiresAt: r.expiresAt });
          start();
        })
        .catch(function (e) {
          err.textContent = (e && e.message) || 'Sign-in failed';
          btn.disabled = false; btn.textContent = 'Sign in';
          document.getElementById('gatePass').value = '';
        });
    });
    if (GOOGLE_CLIENT_ID) mountGoogle();
    document.getElementById('gateUser').focus();
  }

  // ─── Sign in with Google (admins) ───────────────────────────────────────────────────────────
  // The page never decides anything about the Google token: it hands Google's credential to GX Core,
  // which checks signature, audience, domain, freshness and admin role, and answers with the same
  // session a password sign-in gets (plus `assurance`, which Command Center can later require).
  var gisLoading = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { gisLoading = null; reject(new Error('Google sign-in could not load')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  function googleMsg(r) {
    var c = r && r.code;
    if (c === 'not_admin') return 'Google sign-in is for admins. Use your username and password below.';
    if (c === 'unknown_account') return 'That Google account is not linked to a Green Cross user. Ask Sky.';
    if (c === 'no_access') return 'Your account is not set up for any apps yet. Ask Sky to add you.';
    if (c === 'google_unavailable') return "Couldn't reach Google just now. Please try again.";
    return (r && r.error) || 'Google sign-in failed. Please try again.';
  }

  function onGoogleCredential(resp) {
    var errEl = document.getElementById('gErr');
    if (errEl) errEl.textContent = 'Signing in…';
    // retries:1 is replay-safe: a second attempt with the same credential only mints another session
    // for the same person (Core writes nothing else), and a refusal is JSON so it never retries.
    GX.postJSON('google_login', { credential: resp && resp.credential, app: 'portal' }, { retries: 1, timeoutMs: 30000 })
      .then(function (r) {
        if (!r || !r.ok) throw new Error(googleMsg(r));
        setSession({ user: r.user, name: r.displayName || r.user, role: r.role,
                     token: r.token, expiresAt: r.expiresAt, amr: r.amr, assurance: r.assurance });
        start();
      })
      .catch(function (e) {
        var el = document.getElementById('gErr');
        if (el) el.textContent = (e && e.message) || 'Google sign-in failed. Please try again.';
      });
  }

  function mountGoogle() {
    loadGis().then(function () {
      var host = document.getElementById('gBtn');
      if (!host) return;   // the gate was replaced while the script loaded
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onGoogleCredential,
        hd: GOOGLE_DOMAIN,          // a hint for Google's account picker only; GX Core enforces the domain
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      google.accounts.id.renderButton(host, { theme: 'filled_black', size: 'large', shape: 'pill',
        text: 'signin_with', width: 280 });
    }).catch(function () {
      var el = document.getElementById('gErr');
      if (el) el.textContent = 'Google sign-in could not load. Use your username and password.';
    });
  }

  // ─── the page ───────────────────────────────────────────────────────────────────────────────
  function renderShell(sess) {
    document.body.classList.remove('is-gated');
    var top = document.getElementById('topnav'); if (top) top.style.display = '';
    if (window.GXTopNav) {
      try { GXTopNav.startClock(); } catch (e) {}
      GXTopNav.renderUser(document.getElementById('userSlot'), {
        name: sess.name, role: sess.role,
        items: [{ action: 'version', label: 'Version', value: VERSION },
                { action: 'bug', label: 'Report a bug' },
                { action: 'logout', label: 'Sign out', danger: true }],
      });
      if (!navHooked) {
        navHooked = true;
        document.addEventListener('gx-topnav:action', function (ev) {
          var a = ev && ev.detail && ev.detail.action;
          if (a === 'logout') signOut();
          if (a === 'bug' && window.GXBugReport) GXBugReport.open();
        });
      }
    }
    root.innerHTML =
      '<div class="pt-wrap">' +
        '<div class="pt-h">Status</div><div class="pt-status" id="ptStatus"><div class="pt-note">Checking…</div></div>' +
        '<div class="pt-h">Your apps</div><div id="ptApps"><div class="pt-note">Loading your apps…</div></div>' +
      '</div>';
  }

  // Returns true when the session was refused (expired / revoked) so the caller can bounce to sign-in.
  function refused(r) {
    return r && r.ok === false && (r.code === 'invalid_session' || r.code === 'session_expired' || r.code === 'no_access');
  }

  /* Whoever GX Core says holds Command Center (core-admin — Sky only, enforced server-side) lands there
     after sign-in instead of on this page. Based on the app list, never a user name. Command Center's
     "Portal" tile opens /?view=portal, which means "show me the staff view": that sets a per-tab flag
     (sessionStorage) so clicking around here does not bounce them back. Returns true when it navigated. */
  var STAFF_VIEW_KEY = 'portal_staff_view';
  function goToCommandCenter(r) {
    try {
      if (/(?:^|[?&])view=portal(?:&|$)/.test(location.search)) sessionStorage.setItem(STAFF_VIEW_KEY, '1');
      if (sessionStorage.getItem(STAFF_VIEW_KEY) === '1') return false;
    } catch (e) { return false; }
    var cc = ((r && r.apps) || []).filter(function (a) { return a.slug === 'core-admin'; })[0];
    if (!cc) return false;
    var url = cc.url || CC_FALLBACK_URL;
    handoffUrl('core-admin', url).then(function (u) { location.replace(u); });
    return true;
  }

  /* OPEN AN APP ALREADY SIGNED IN. The apps live on other origins, so this page's session cannot reach
     them; GX Core mints a 60-second, single-use code for (this person, that app) and the app trades it
     for its own normal session — the person's real grant there, never more (handoff_code /
     handoff_exchange in gx_core.gs). The code rides in the URL FRAGMENT, which is never sent to a
     server, and the app wipes it from the address bar on load. The session token itself never goes in
     a URL. Any failure here opens the plain URL: the app's own sign-in form is still there.
     The Google assurance stamp is passed along so a Google sign-in stays a Google sign-in in the app;
     GX Core re-checks it rather than believing it. */
  function handoffUrl(slug, url) {
    var s = getSession();
    if (!s || !slug || !url) return Promise.resolve(url);
    return GX.postJSON('handoff_code', { token: s.token, app: slug, assurance: s.assurance || '' },
      { retries: 1, timeoutMs: 20000 })   // a retried mint only leaves an unused code to expire
      .then(function (r) {
        if (!r || !r.ok || !/^h1\.[A-Za-z0-9_-]+$/.test(String(r.code || ''))) return url;
        return url.split('#')[0] + '#gxcode=' + r.code;
      })
      .catch(function () { return url; });
  }

  /* A tile click. The new tab is opened INSIDE the click (a tab opened after an await is a popup, and
     browsers block those), shows a holding line while the code is fetched, then is sent on. Modified
     clicks (new window, background tab, middle button) keep the plain link: no code is minted for a tab
     nobody may look at within the minute. */
  function onTileClick(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('a.pt-tile[data-slug]') : null;
    if (!el) return;
    if (ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    var url = el.getAttribute('href'), slug = el.getAttribute('data-slug'), name = el.getAttribute('data-name') || 'the app';
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (w) {
      try {
        w.document.title = 'Opening ' + name + '…';
        w.document.body.style.cssText = 'font:16px system-ui,sans-serif;background:#0b1410;color:#e6f2ea;display:flex;align-items:center;justify-content:center;height:100vh;margin:0';
        w.document.body.textContent = 'Opening ' + name + '…';
      } catch (e) {}
    }
    handoffUrl(slug, url).then(function (u) {
      if (w && !w.closed) { try { w.opener = null; } catch (e) {} w.location.replace(u); }
      else location.href = u;   // popup blocked: open it here instead of not at all
    });
  }

  function renderApps(r) {
    var host = document.getElementById('ptApps'); if (!host) return;
    var apps = (r && r.apps) || [];
    if (!apps.length) { host.innerHTML = '<div class="pt-note">No apps are set up for you yet. Ask Sky to add you.</div>'; return; }
    if (!host.__gxHandoff) { host.addEventListener('click', onTileClick); host.__gxHandoff = true; }
    host.innerHTML = '<div class="pt-grid">' + apps.map(function (a) {
      var url = a.url || (a.slug === 'core-admin' ? CC_FALLBACK_URL : '');
      var tag = url ? 'a' : 'div';
      var href = url ? ' href="' + esc(url) + '" target="_blank" rel="noopener" data-slug="' + esc(a.slug) + '" data-name="' + esc(a.name) + '"' : '';
      return '<' + tag + ' class="gx-card pt-tile"' + href + '>' +
        '<span class="pt-ic" style="background:' + esc(a.color || '#4ade80') + '">' + esc(String(a.name || '?').charAt(0)) + '</span>' +
        '<span><b>' + esc(a.name) + '</b><small>' + esc(a.tagline || '') + '</small></span></' + tag + '>';
    }).join('') + '</div>';
  }

  function renderStatus(r) {
    var host = document.getElementById('ptStatus'); if (!host) return;
    var items = (r && r.items) || [];
    if (!items.length) { host.innerHTML = '<div class="pt-note">Status is unavailable right now.</div>'; return; }
    host.innerHTML = items.map(function (i) {
      var st = (i.status === 'green' || i.status === 'yellow' || i.status === 'red') ? i.status : 'yellow';
      return '<div class="gx-card pt-light" title="' + esc(i.label) + ': ' + esc(i.text) + '">' +
        '<span class="pt-dot ' + st + '"></span><span><b>' + esc(i.label) + '</b><small>' + esc(i.text) + '</small></span></div>';
    }).join('');
  }

  function loadStatus(sess) {
    return GX.jsonp('portal_status', { token: sess.token }).then(function (r) {
      if (refused(r)) { signOut(); return; }
      renderStatus(r);
    }).catch(function () {
      // Core unreachable: say so, never leave the last (possibly green) answer on screen.
      renderStatus({ items: [{ label: 'GX Core', status: 'yellow', text: "Can't reach it right now" }] });
    });
  }

  function start() {
    var sess = getSession();
    if (!sess) { renderGate(''); return; }
    renderShell(sess);
    GX.jsonp('my_apps', { token: sess.token }).then(function (r) {
      if (refused(r)) { signOut(); return; }
      if (goToCommandCenter(r)) return;
      renderApps(r);
    }).catch(function () {
      var host = document.getElementById('ptApps');
      if (host) host.innerHTML = '<div class="pt-note">Could not load your apps. Pull down to retry.</div>';
    });
    loadStatus(sess);
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) loadStatus(sess); }, STATUS_EVERY_MS);
  }

  start();
})();
