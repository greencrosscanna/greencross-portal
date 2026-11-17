#!/usr/bin/env node
/* Sign in with Google — portal side.   RUN: node tests/google_signin_test.js
 *
 * The portal decides nothing about a Google token (GX Core does every check — see
 * greencross-command-center tests/google_login_test.js). What can go wrong HERE:
 *   - the portal's client ID differs from GX Core's, so every admin is refused with wrong_audience;
 *   - the Google button shows while no client ID is set (a button that can only fail);
 *   - the assurance stamp is dropped, so Command Center can never later tell a Google session apart;
 *   - Google's script is loaded from anywhere but accounts.google.com.
 * Source-level checks, by design: this repo has no browser harness. */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };
const js = fs.readFileSync(path.join(__dirname, '..', 'portal.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const m = /var GOOGLE_CLIENT_ID = '([^']*)';/.exec(js);
ok(!!m, 'portal.js declares GOOGLE_CLIENT_ID in the shape this test reads');
const portalId = m ? m[1] : null;

// Cross-repo: the hub's copy, when the hub is checked out beside this repo.
const hubSrc = path.join(__dirname, '..', '..', 'greencross-command-center', 'gx_core.gs');
if (fs.existsSync(hubSrc)) {
  const h = /const GX_GOOGLE_CLIENT_ID\s*=\s*'([^']*)';/.exec(fs.readFileSync(hubSrc, 'utf8'));
  ok(!!h, 'GX Core declares GX_GOOGLE_CLIENT_ID');
  ok(h && h[1] === portalId, 'the portal and GX Core name the SAME Google client (else every admin is refused)');
} else {
  console.log('  SKIP  hub not checked out beside this repo — client ID match not checked');
}

ok(/\(GOOGLE_CLIENT_ID\s*\n?\s*\?\s*'<div class="pt-google">/.test(js), 'the Google block renders only when a client ID is set');
ok(/if \(GOOGLE_CLIENT_ID\) mountGoogle\(\);/.test(js), 'and Google is only mounted then');
ok(js.indexOf("s.src = 'https://accounts.google.com/gsi/client';") >= 0, "Google's script comes from accounts.google.com, nowhere else");
ok((js.match(/https:\/\/accounts\.google\.com/g) || []).length === 1, 'and no other Google URL is referenced');
ok(/GX\.postJSON\('google_login', \{ credential: resp && resp\.credential, app: 'portal' \}/.test(js), 'the credential goes to GX Core google_login as a POST body, never in a URL');
ok(/assurance: r\.assurance/.test(js) && /amr: r\.amr/.test(js), 'the session keeps amr + assurance (Command Center will need them)');
ok(/disableAutoSelect\(\)/.test(js), 'signing out stops Google auto-selecting the account next time');
ok(/GX_DEV_READS = \[[^\]]*'google_login'/.test(html), 'local dev guard lets the sign-in through, like login');
const v = /portal\.js\?v=([\d.]+)/.exec(html), jv = /var VERSION = 'v([\d.]+)'/.exec(js);
ok(v && jv && v[1] === jv[1], 'index.html cache-buster and VERSION agree (' + (v && v[1]) + ')');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
