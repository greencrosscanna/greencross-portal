#!/bin/sh
# Compare Crew's live page version with what GX Core's release history records.
echo "== live page =="
curl -s "https://greencrosscanna.github.io/greencross-crew/?nocache=$(date +%s)" | grep -o 'crew.js?v=[0-9.]*'
echo "== recorded history (latest) =="
curl -sL "https://script.google.com/macros/s/AKfycbx9mjeCBbDpxNYaqBv2hyZaO1hpbGG6PZM9AebFdwl0UwkdtRCGSWrH-8ohEtdF1K_6/exec?action=version_history&app=crew" | head -c 1500
echo
