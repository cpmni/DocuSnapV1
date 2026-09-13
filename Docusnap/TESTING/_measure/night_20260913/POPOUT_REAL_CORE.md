# Night 2026-09-13 — the client search pop-out on REAL core code (item 3 of `docs/designs/NIGHT_RUN_2026-09-13_LATE.md`)

The owner's last live report: "the search window in the client doesn't open". Not reproducible against a hermetic
`/v1` handler (`drive_popout.js` + `fake_core.js`), so tonight it was driven against a REAL dev core:

- **Sandbox core:** `scripts/seed-chris-sandbox.js` (fresh DB + the machine-bound licence rows only) →
  `night_sandbox_setup.js` (users `nightadmin`/admin + `nightreader`/readonly, `client_api_enabled` on port 8797,
  first-run gates off, two placeholder documents) → `DOCUSNAP_USERDATA=<sandbox> SCANFINDER_API=1 TEST_BUILD=1
  npm start -- --remote-debugging-port=9223` (the owner's own configuration: TEST_BUILD arming, the access gate,
  the real `/v1` listener with its ctx).
- **Real client:** `client\node_modules\electron\dist\electron.exe . --user-data-dir=<sandbox>\client-ud
  --remote-debugging-port=9226` with `SCANFINDER_CLIENT_API_URL=http://127.0.0.1:8797`, driven over CDP by
  `drive_popout_real.js` (playwright-core `connectOverCDP`).

## Results — 20/20
| phase | scenario | result |
|---|---|---|
| 1 | press Search BEFORE signing in | refused `{ok:false,error:'not signed in'}`; the main window toasts "Sign in first, then open Search." |
| 1 | sign in (admin) → Search | a second window opens (`…/search/index.html`), visible, 2 rows, role admin, entitled, caps: S2 reads ON (core 1.3.0), no "newer core" hint |
| 1 | click a row | the field table renders; actions = Delete + "✉ Send…" (workflow licensed on this licence); desktop-only actions hidden |
| 1 | change the theme in the main window | the pop-out re-themes live (midnight) |
| 1 | sign out | the pop-out closes (`closed by main: logout`) |
| 1 | sign in again → Search | opens again |
| 2 | the CORE is restarted under a signed-in client (stale token) → Search | the pop-out is created, shown, then `closed by main: session-expired (the pop-out saw a 401)`; the main window goes to the login screen AND (after the night fix `5195bfa`) toasts "Your session ended — the search window closed. Please sign in again." |
| 2 | sign in again → Search | opens with the rows |
| 3 | read-only user → Search | opens; 1 row (no unconfirmed for read-only); the writer-gated `/v1/doc-types` 403 leaves the type filter at "All types" and does NOT stop the boot; no recycle-bin button; no Delete |

`client_popout_log.txt` = the client's stderr with the `[search-popout]` lines for every create / show / close (with
the reason) / refusal.

## What this says about the owner's report
The window opens on real core code in every state a user can be in. The one state that LOOKS like "doesn't open"
is phase 2: a session that died (the core restarted — which the main session did twice while the owner was
testing) makes the window appear for a moment and vanish, with the client dropping to its login screen. Before
tonight that drop was SILENT when the heartbeat had already signed out; now it always says why. Morning check:
ask the owner whether the client had shown its login screen again at that point.
