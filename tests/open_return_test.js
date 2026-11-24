#!/usr/bin/env node
/* 30-day sign-in + ?open=<app> return — portal side.   RUN: node tests/open_return_test.js
 *
 * Every app's "Sign in with Google" button sends the person to the portal with ?open=<app key>.
 * What can go wrong HERE:
 *   - an unknown key (or a URL smuggled in as one) is used to build where the person is sent;
 *   - open= stays in the address bar, so a reload or a bookmark fires it again;
 *   - it fires twice (a loop), or never fires after a FRESH Google sign-in;
 *   - someone without that app is sent to it instead of seeing the portal;
 *   - the sign-in still dies with the tab, or an old tab-scoped session is lost on upgrade;
 *   - sign-out leaves a session behind in either store.
 * Runs the real functions out of portal.js against stub storage, history and GX Core. */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };
const js = fs.readFileSync(path.join(__dirname, '..', 'portal.js'), 'utf8');

function pick(name) {
  const i = js.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = js.indexOf('{', i);
  for (; j < js.length; j++) { if (js[j] === '{') d++; else if (js[j] === '}' && --d === 0) break; }
  return js.slice(i, j + 1);
}
function line(re) {
  const m = re.exec(js);
  if (!m) throw new Error('missing ' + re);
  return m[0];
}

function store(init) {
  const m = Object.assign({}, init || {});
  return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}

// A portal page loaded at `search`, with stubbed browser + GX Core.
function page(o) {
  o = o || {};
  const replaced = [], minted = [], drawn = [];
  const local = store(o.local), sess = store(o.session);
  const location = { search: o.search || '', pathname: '/', hash: o.hash || '', replace: u => replaced.push(u) };
  const history = { state: null, calls: [], replaceState(s, t, u) { this.calls.push(u); location.search = u.replace(/^[^?#]*/, '').replace(/#.*$/, ''); } };
  const apps = o.apps || [
    { slug: 'inventory', name: 'Inventory', url: 'https://greencrosscanna.github.io/greencross-inventory/' },
    { slug: 'sales', name: 'Sales', url: 'https://greencrosscanna.github.io/greencross-sales/' },
  ];
  const GX = {
    postJSON: (action, body) => {
      if (action === 'handoff_code') { minted.push(body.app); return Promise.resolve({ ok: true, code: 'h1.' + 'A'.repeat(43) }); }
      if (action === 'google_login') return Promise.resolve({ ok: true, user: 'tawny', displayName: 'Tawny', role: 'manager', token: 'tawny:9999999999999:SIG', expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), amr: 'google', assurance: 'g1.stamp' });
      return Promise.resolve({ ok: false });
    },
    jsonp: () => Promise.resolve(o.myApps || { ok: true, apps }),
  };
  const stubs = {
    renderShell() {}, renderGate() {}, showLoader() {}, hideLoader() {}, loadStatus() {},
    renderApps: r => drawn.push(r), goToCommandCenter: () => false,
    setInterval: () => 1, clearInterval() {}, document: { getElementById: () => null, hidden: false },
  };
  const names = ['GX', 'localStorage', 'sessionStorage', 'location', 'history', 'URLSearchParams',
    'CC_FALLBACK_URL', 'SESSION_KEY', 'STATUS_EVERY_MS', 'timer'].concat(Object.keys(stubs));
  const src = [
    line(/var OPEN_KEYS = \[[^\]]*\];/),
    pick('expiryMs'), pick('migrateSession'), pick('getSession'), pick('setSession'), pick('clearSession'),
    pick('handoffUrl'), pick('validOpenKey'), pick('readOpenParam'),
    line(/var pendingOpen = readOpenParam\(\);/),
    pick('openRequestedApp'), pick('refused'), pick('start'), pick('onGoogleCredential'), pick('googleMsg'),
    'return { validOpenKey, readOpenParam, openRequestedApp, getSession, setSession, clearSession, start, onGoogleCredential, pending: () => pendingOpen };',
  ].join('\n');
  const f = new Function(...names, src);
  const api = f(GX, local, sess, location, history, URLSearchParams,
    'https://script.google.com/macros/s/CC/exec', 'portal_session', 60000, null, ...Object.values(stubs));
  return { api, local, sess, location, history, replaced, minted, drawn };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const live = JSON.stringify({ token: 'tawny:9999999999999:SIG', expiresAt: new Date(Date.now() + 864e5).toISOString(), assurance: 'g1.stamp' });

(async function () {
  console.log('\n1. key validation — only the portal\'s own app keys');
  {
    const { api } = page();
    for (const k of ['inventory', 'sales', 'performance', 'pricecards', 'spiff', 'crew', 'displayshop', 'core-admin']) {
      ok(api.validOpenKey(k) === k, k + ' is accepted');
    }
    for (const k of ['leaderboard', 'INVENTORY', ' inventory', 'https://evil.test/', 'javascript:alert(1)', '__proto__', 'constructor', '', null, undefined, ['inventory']]) {
      ok(api.validOpenKey(k) === null, JSON.stringify(k === undefined ? 'undefined' : k) + ' is refused');
    }
  }

  console.log('\n2. the address bar');
  {
    const p = page({ search: '?open=inventory', hash: '' });
    ok(p.api.pending() === 'inventory', 'a known key is held for after sign-in');
    ok(p.history.calls.length === 1 && p.history.calls[0] === '/', 'open= is wiped from the address bar on load');
    const q = page({ search: '?view=portal&open=sales&x=1', hash: '#h' });
    ok(q.history.calls[0] === '/?view=portal&x=1#h', 'other parameters and the fragment are kept');
    const u = page({ search: '?open=https%3A%2F%2Fevil.test%2F' });
    ok(u.api.pending() === null, 'an unknown key is not held');
    ok(u.history.calls[0] === '/', 'but is still wiped from the address bar');
    const n = page({ search: '?view=portal' });
    ok(n.history.calls.length === 0 && n.api.pending() === null, 'no open= → the address bar is not touched');
  }

  console.log('\n3. already signed in, holds the app → straight back to it, signed in');
  {
    const p = page({ search: '?open=inventory', local: { portal_session: live } });
    p.api.start(); await settle();
    ok(p.replaced.length === 1 && /^https:\/\/greencrosscanna\.github\.io\/greencross-inventory\/#gxcode=h1\./.test(p.replaced[0]), 'sent to the URL GX Core lists for Inventory, with a hand-off code');
    ok(p.minted.length === 1 && p.minted[0] === 'inventory', 'the code was minted for THAT app');
    ok(p.drawn.length === 0, 'the portal tiles are not drawn underneath');
    p.api.start(); await settle();
    ok(p.replaced.length === 1, 'a second app-list load does NOT fire it again (one shot, no loop)');
    ok(p.drawn.length === 1, 'and shows the portal instead');
  }

  console.log('\n4. not signed in → fires after a FRESH Google sign-in');
  {
    const p = page({ search: '?open=sales' });
    p.api.start(); await settle();
    ok(p.replaced.length === 0 && p.api.pending() === 'sales', 'not signed in: nothing happens yet, the request waits');
    p.api.onGoogleCredential({ credential: 'google.jwt' }); await settle();
    ok(p.replaced.length === 1 && /^https:\/\/greencrosscanna\.github\.io\/greencross-sales\/#gxcode=h1\./.test(p.replaced[0]), 'after Google sign-in: sent to Sales, signed in');
    ok(p.api.pending() === null, 'and the request is used up');
  }

  console.log('\n5. no access, or an unknown key → the portal, as normal');
  {
    const p = page({ search: '?open=crew', local: { portal_session: live } });
    p.api.start(); await settle();
    ok(p.replaced.length === 0 && p.minted.length === 0, 'holds no Crew grant: not sent anywhere, no code minted');
    ok(p.drawn.length === 1, 'the portal is shown');
    const u = page({ search: '?open=evil', local: { portal_session: live }, apps: [{ slug: 'evil', url: 'https://evil.test/' }] });
    u.api.start(); await settle();
    ok(u.replaced.length === 0, 'an unknown key is ignored even if the app list somehow named it');
    const j = page({ search: '?open=inventory', local: { portal_session: live }, apps: [{ slug: 'inventory', url: 'javascript:alert(1)' }] });
    j.api.start(); await settle();
    ok(j.replaced.length === 0 && j.drawn.length === 1, 'a non-https app URL is never navigated to');
    const r = page({ search: '?open=inventory', local: { portal_session: live }, myApps: { ok: false, code: 'session_expired' } });
    r.api.start(); await settle();
    ok(r.replaced.length === 0 && r.api.pending() === 'inventory', 'an expired session keeps the request for after re-sign-in');
  }

  console.log('\n6. sign-in storage — survives the tab, migrates the old one, sign-out clears both');
  {
    const p = page();
    p.api.setSession({ token: 't', expiresAt: Date.now() + 864e5 });
    ok(!!p.local.m.portal_session && !p.sess.m.portal_session, 'a new sign-in is saved to localStorage (survives closing the tab)');
    const m = page({ session: { portal_session: live } });
    const s = m.api.getSession();
    ok(s && s.token === 'tawny:9999999999999:SIG', 'an old tab-scoped sign-in is still honored');
    ok(m.local.m.portal_session === live && !('portal_session' in m.sess.m), 'and moved to localStorage, then removed from sessionStorage');
    const both = page({ local: { portal_session: live }, session: { portal_session: '{"token":"older"}' } });
    ok(both.api.getSession().token === 'tawny:9999999999999:SIG' && both.sess.m.portal_session === '{"token":"older"}', 'a localStorage session is never overwritten by an old one');
    const exp = page({ local: { portal_session: JSON.stringify({ token: 't', expiresAt: new Date(Date.now() - 1000).toISOString() }) } });
    ok(exp.api.getSession() === null, 'an expired sign-in is refused (30-day limit still enforced)');
    const bad = page({ local: { portal_session: JSON.stringify({ token: 't', expiresAt: 'soon' }) } });
    ok(bad.api.getSession() === null, 'an unreadable expiry fails closed');
    both.api.clearSession();
    ok(!('portal_session' in both.local.m) && !('portal_session' in both.sess.m), 'sign-out clears both stores');
  }

  console.log('\n7. wiring');
  ok(/if \(refused\(r\)\) \{ signOut\(\); return; \}\s*\n\s*if \(openRequestedApp\(r\)\) return;\s*[^\n]*\n\s*if \(goToCommandCenter\(r\)\) return;/.test(js), 'start(): refused → sign-in, then ?open=, then Command Center');
  ok(js.indexOf('var pendingOpen = readOpenParam();') < js.lastIndexOf('\n  start();'), 'open= is read (and wiped) before the first start()');
  ok(!/sessionStorage\.setItem\(SESSION_KEY/.test(js), 'nothing writes the session to sessionStorage any more');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
