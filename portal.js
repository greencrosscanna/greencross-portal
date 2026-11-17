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
  var VERSION = 'v1';
  window.PORTAL_VERSION = VERSION;
  var SESSION_KEY = 'portal_session';
  var STATUS_EVERY_MS = 60000;
  // The registry has no URL for Command Center (it is served by GX Core itself).
  var CC_FALLBACK_URL = GXCORE_URL;

  var GX = GXClient(GXCORE_URL, { retries: 3 });
  var root = document.getElementById('app');
  var timer = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // sessionStorage, like the other credentialed apps: closing the tab ends the session.
  function getSession() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.token && (!s.expiresAt || Number(s.expiresAt) > Date.now())) return s;
    } catch (e) {}
    return null;
  }
  function setSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function signOut() {
    clearSession();
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
    document.getElementById('gateUser').focus();
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
                { action: 'logout', label: 'Sign out', danger: true }],
      });
      document.addEventListener('gx-topnav:action', function (ev) {
        var a = ev && ev.detail && ev.detail.action;
        if (a === 'logout') signOut();
      });
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

  function renderApps(r) {
    var host = document.getElementById('ptApps'); if (!host) return;
    var apps = (r && r.apps) || [];
    if (!apps.length) { host.innerHTML = '<div class="pt-note">No apps are set up for you yet. Ask Sky to add you.</div>'; return; }
    host.innerHTML = '<div class="pt-grid">' + apps.map(function (a) {
      var url = a.url || (a.slug === 'core-admin' ? CC_FALLBACK_URL : '');
      var tag = url ? 'a' : 'div';
      var href = url ? ' href="' + esc(url) + '" target="_blank" rel="noopener"' : '';
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
