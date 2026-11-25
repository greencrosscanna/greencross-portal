#!/bin/sh
# Run every portal test plus a syntax check on portal.js.
cd "/Users/skypinnick/Library/CloudStorage/Dropbox/GX Dashboards/greencross-portal" || exit 1
rc=0
for t in tests/*_test.js; do
  if node "$t" >/dev/null 2>&1; then echo "PASS $t"; else echo "FAIL $t"; node "$t" 2>&1 | tail -15; rc=1; fi
done
node --check portal.js && echo "syntax ok portal.js" || rc=1
exit $rc
