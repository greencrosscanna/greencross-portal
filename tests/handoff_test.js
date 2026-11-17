#!/usr/bin/env node
/* Portal → app hand-off — portal side.   RUN: node tests/handoff_test.js
 *
 * GX Core does every check (greencross-command-center tests/handoff_test.js). What can go wrong HERE:
 *   - the session token itself ends up in a URL (it must never);
 *   - the code goes in the query string, which servers log, instead of the fragment;
 *   - the tab is opened after the await, so it is a popup and gets blocked;
 *   - a failed mint leaves the person with nothing instead of the plain app URL;
 *   - the Google stamp is not passed, so a Google sign-in becomes a password one in the app.
 * Runs the real handoffUrl / onTileClick against a stub GX Core. */
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

function world(o) {
  o = o || {};
  const calls = [];
  const sess = o.session === undefined ? { token: 'tawny:9999999999999:SIG', assurance: 'g1.stamp' } : o.session;
  const GX = { postJSON: (action, body, opts) => { calls.push({ action, body, opts }); return o.mint ? o.mint() : Promise.resolve({ ok: true, code: 'h1.' + 'A'.repeat(43) }); } };
  const opened = [];
  const win = { closed: false, opener: {}, document: { title: '', body: { style: {}, textContent: '' } },
    location: { replace: u => { win.went = u; } } };
  const env = {
    GX, getSession: () => sess,
    window: { open: () => { opened.push(Date.now()); return o.blocked ? null : win; } },
    location: { href: '' },
  };
  const f = new Function('GX', 'getSession', 'window', 'location',
    pick('handoffUrl') + '\n' + pick('onTileClick') + '\nreturn { handoffUrl: handoffUrl, onTileClick: onTileClick };');
  const api = f(env.GX, env.getSession, env.window, env.location);
  return { api, calls, opened, win, env };
}
function tile(slug, url) {
  const el = { getAttribute: k => ({ href: url, 'data-slug': slug, 'data-name': 'Inventory' })[k] };
  return { button: 0, target: { closest: () => el }, preventDefault() { this.prevented = true; } };
}
const tick = () => new Promise(r => setTimeout(r, 0));

(async function () {
  console.log('\n1. the URL an app is opened with');
  {
    const { api, calls } = world();
    const u = await api.handoffUrl('inventory', 'https://greencrosscanna.github.io/greencross-inventory/');
    ok(u === 'https://greencrosscanna.github.io/greencross-inventory/#gxcode=h1.' + 'A'.repeat(43), 'the code rides in the FRAGMENT');
    ok(u.indexOf('?') < 0, 'and nothing is added to the query string (servers log those)');
    ok(u.indexOf('SIG') < 0 && u.indexOf('tawny:') < 0, 'the session token is NOT in the URL');
    ok(calls.length === 1 && calls[0].action === 'handoff_code' && calls[0].body.app === 'inventory', 'GX Core was asked for a code for THAT app');
    ok(calls[0].body.token === 'tawny:9999999999999:SIG', 'the token goes in the POST body');
    ok(calls[0].body.assurance === 'g1.stamp', 'the Google stamp is passed for GX Core to re-check');
    const u2 = await world().api.handoffUrl('crew', 'https://x.test/crew/#old');
    ok(/^https:\/\/x\.test\/crew\/#gxcode=h1\./.test(u2), 'an existing fragment on the registry URL is replaced, not appended to');
  }

  console.log('\n2. a failed mint still opens the app (its own sign-in is there)');
  {
    for (const [label, mint] of [
      ['GX Core refuses (no_access)', () => Promise.resolve({ ok: false, code: 'no_access' })],
      ['GX Core unreachable', () => Promise.reject(new Error('net'))],
      ['a malformed code', () => Promise.resolve({ ok: true, code: 'h1.<script>' })],
    ]) {
      const u = await world({ mint }).api.handoffUrl('inventory', 'https://a.test/inv/');
      ok(u === 'https://a.test/inv/', label + ' → the plain URL');
    }
    const u = await world({ session: null }).api.handoffUrl('inventory', 'https://a.test/inv/');
    ok(u === 'https://a.test/inv/', 'no portal session → the plain URL, and nothing asked');
  }

  console.log('\n3. the tab');
  {
    const w = world();
    const ev = tile('inventory', 'https://a.test/inv/');
    w.api.onTileClick(ev);
    ok(ev.prevented && w.opened.length === 1, 'the new tab is opened INSIDE the click, before any await (else it is a blocked popup)');
    await tick(); await tick();
    ok(/^https:\/\/a\.test\/inv\/#gxcode=h1\./.test(w.win.went), 'then sent to the app with the code');
    ok(w.win.opener === null, 'and cut off from this page (rel=noopener, kept)');
    const b = world({ blocked: true });
    b.api.onTileClick(tile('inventory', 'https://a.test/inv/'));
    await tick(); await tick();
    ok(/^https:\/\/a\.test\/inv\/#gxcode=h1\./.test(b.env.location.href), 'popup blocked → opened in this tab instead of not at all');
    const m = world();
    const mev = tile('inventory', 'https://a.test/inv/'); mev.metaKey = true;
    m.api.onTileClick(mev);
    ok(!mev.prevented && m.calls.length === 0, 'a modified click keeps the plain link and mints nothing');
  }

  console.log('\n4. wiring');
  ok(/data-slug="' \+ esc\(a\.slug\)/.test(js), 'tiles carry their app slug');
  ok(/host\.addEventListener\('click', onTileClick\)/.test(js), 'the grid listens for tile clicks');
  ok(/handoffUrl\('core-admin', url\)\.then\(function \(u\) \{ location\.replace\(u\); \}\)/.test(js), 'Command Center holders land in Command Center signed in, too');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
