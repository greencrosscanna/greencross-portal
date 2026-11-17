# GX Portal — staff launch pad

**App key: `portal`** (`.gx_app`). Repo `greencross-portal`, GitHub Pages, custom domain
`apps.greencrosscanna.com` (the `CNAME` file). Standalone — not an Inventory sub-app.

## What it is

One sign-in for admins, managers and assistant managers, and two things on the page: a **Launch tile**
for every app the person holds, and a plain **green/yellow/red Status strip**. It exists because staff
were digging through email for app links. It is a **separate page, not Command Center with things
hidden**: Command Center holds admin controls.

- **Who gets in:** anyone with at least one active app grant. There is no `portal` grant row — GX Core's
  `gxRoleForApp_` resolves `portal` to `viewer` for any holder of another grant.
- **Tiles:** whatever `?action=my_apps` returns. The server filters; this repo only draws. Command Center
  is listed for Sky only, decided in GX Core (`GX_PORTAL_SKY_ONLY`), never in this file.
- **Status:** `?action=portal_status` — Dutchie, Sales data, Inventory sync, plus QuickBooks for Shawn and
  admins. A word and a plain label only; `api_health` itself stays secret-gated. A light that cannot be
  read shows yellow, never green.
- Ops-board to-dos on the portal are v2 — not built.

## Layout

| File | Role |
|---|---|
| `index.html` | shell from gx-theme's `gx-app-template.html` |
| `portal.js` | sign-in gate, tiles, status strip (all GX Core calls via `GXClient`) |
| `CNAME` | `apps.greencrosscanna.com` |

No backend and no build step. Dev port is **8756**; `serve.py` has no `portal` entry yet (shared file —
core-admin adds it in gx-theme), so until then use `python3 -m http.server 8756`. `gx-dev.js` blocks writes
until armed; the portal writes nothing but the sign-in.

Nothing local restyles a shared component; send core-admin a note for gx-theme changes.

## Sync with the brain

`/gxbrain` loads the shared rules and reconciles with GX Core; `/gxwhatsnext` pulls this app's next work.
Brain notes for this app surface at session start (`.claude/gx-brain-notes.sh`).

## Shipping

Bump `?v=N` on the `portal.js` tag, then `./deploy.sh` (records the release in `app_versions`). Features go on
a `feat/…` branch + PR the session merges when green; small fixes direct to `main`. A deploy needs Sky's word.

**Close the loop:** when a task's goals look met, say so and offer to ship it; then re-list what is open,
numbered.

## Known gaps

- No bug reporter yet: GX Core has no token-gated bug-filing route for a backend-less app. Needs one in Core.
- The Command Center tile links to GX Core's own `/exec` URL (the registry holds no URL for it).
