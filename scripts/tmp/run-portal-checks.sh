#!/bin/sh
# Run every portal test plus syntax checks on the two page scripts.
cd "/Users/skypinnick/Library/CloudStorage/Dropbox/GX Dashboards/greencross-portal" || exit 1
for t in tests/*_test.js; do
  if node "$t" >/dev/null 2>&1; then echo "PASS $t"; else echo "FAIL $t"; node "$t" 2>&1 | tail -15; fi
done
node --check "/Users/skypinnick/Library/CloudStorage/Dropbox/GX Dashboards/greencross-portal/joint-loader.js" && echo "syntax ok joint-loader.js"
node --check "/Users/skypinnick/Library/CloudStorage/Dropbox/GX Dashboards/greencross-portal/portal.js" && echo "syntax ok portal.js"
