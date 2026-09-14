# HANDOVER 2026-09-15 NIGHT — cold start for the next session (written for Claude Opus 4.8)

Branch `feat/teach-side-overnight`. **HEAD `354c23d`; 5 NEW commits tonight, ALL LOCAL / UNPUSHED (owner's call);
tree clean. Full pin gate `npm run test:pins` = 371/371 GREEN.** The owner said "please do all if possible.
Goodnight" → this was an autonomous night run under the standing protocol (auto+safe; approval-class LOGGED +
skipped; nothing pushed / flipped / shipped).

## TL;DR — what shipped tonight (5 commits, every one DARK/safe + pinned; nothing pushed)
1. **`3680486` docs(licenses)** — jsQR (Apache-2.0) added to `client/THIRD-PARTY-LICENSES.txt` (it's vendored, so
   the license gate's npm scan can't see it); also corrected the stale "Electron 31"→44. (Was an owed item.)
2. **`11e1cc3` security(backup) — DARK** — closes the Chris-card-7 fabricated-device-fingerprint restore hole.
   The backup restore trusted the `device_fp` embedded in the untrusted backup blob (attacker computes this
   machine's fp from readable MachineGuid+productId, edits the blob to match). New pure predicate
   `src/lib/deviceImportGate.js` (a signature-verified, fp-bound, active PAID seat is the sole non-dev anchor; it
   never receives device_fp). Gated behind **`backup_import_seat_only`** (default OFF = byte-identical). Pin
   `src/services/test_device_import_gate.js` 10/10. (gary diagnosed; report in the task history.)
3. **`58224b3` security(v1) — DARK** — closes audit finding A1: `/v1/auth/login` AND `/v1/enroll` handed a full
   session to a never-changed temp-password account (`authService.login` dropped `must_change_password`). Now
   carried through (authService + sessionService `mustChange`), and `requireSession` refuses every route but
   change-password/logout for a restricted session. Gated behind **`v1_force_password_change`** (default OFF =
   byte-identical). Pins added to `src/modules/api/test_v1_auth.js` (OFF byte-identical; ON closes it). (eric
   designed.)
4. **`edc1c03` fix(client,settings)** — the Chris round-A **safe fix pass** (copy/UX; see Chris section):
   - **Quick File misfile fix (client, round-A card 1, the highest):** the identity fields (COMPANY/REFERENCE/
     NOTES) now CLEAR after a clean file (they stayed armed → the next doc could be filed under the last one's
     details). Plural "(s)" fixed; names where it went.
   - **Connect address (core Settings, BOTH Chris runs' #1 blocker):** the connect card showed the raw bind host
     `0.0.0.0` (which no client can dial — it's `managedCertStatus.host = cfg.host`, handler.js:1622). Now shows
     the real reachable IPv4 SANs (lists several); status line no longer presents 0.0.0.0 as a URL. Renderer-only.
   - **Safety-code naming (core Settings):** the CA fingerprint is labelled **"ID code"** to match the client's
     cert-check prompt; the disclosure reads "Security certificate & ID code".
   - **Connect errors (client):** raw ETIMEDOUT/getaddrinfo/"pairing code expired" mapped to plain guidance with
     a next step. CA-file field jargon softened to "Most people can skip this…".
5. **`354c23d` feat(teach-over-client) S4 — DARK** — client-PC **upload-to-teach**: `POST /v1/teach/stage`
   (admin + entitlement + license + the `teach_over_client_enabled` switch (default OFF) + in-flight cap 1 +
   size cap + a `render/pages.py --count` page-cap PRE-PROBE before OCR; drives the shared batch import with
   `autoFile:false` so a graduated scope still lands `needs_review`). Client `caps.import=true` + `btn-import-teach`
   wired. Oracle C8-C14 all satisfied (design `docs/designs/TEACH_OVER_CLIENT_2026-09-14.md` "# B"). Pins
   `test_v1_teach.js` 81/81; `test_v1_confirm_never_teaches` + sync + no-direct-IPC all green. Contract stays 1.7.0.

## NEEDS YOUR APPROVAL (morning) — nothing below was done at night
1. **Push** the 5 local commits (HEAD `354c23d`).
2. **Flip the two security switches to enforce** (they are DARK/OFF = the holes are still open until flipped):
   - `v1_force_password_change` = '1'  (forces a temp-password change over /v1)
   - `backup_import_seat_only` = '1'  (backup restore needs a real paid seat; a forged same-machine fp is refused)
   Both eric/gary recommend defaulting these ON in shipped builds (a future migration/build-arm). The DARK
   choice tonight was only to keep the night byte-identical — you WANT these on.
3. **Flip `teach_over_client_enabled` = 'true'** to turn on teach-over-client (S1-S4). Then S4's upload-to-teach
   is live. (A live end-to-end test of S4 is owed — it needs a client restart to load, so Chris couldn't drive it.)
4. **Rebuild the TEST installer pair** on this HEAD if shipping the customer (core `npm run build:test` + client
   `cd client && npm run dist`) — carries teach + connection + the date fix + tonight's fixes. Owed at the client
   build: jsqr is already in the notice.
5. **The DARK flip gates** (unchanged from before; no extraction change tonight so no re-measure was needed):
   migs 166/167 (engine half) / 159 / 156 / 143.

## Chris night run (both rounds sandboxed on the running apps; findings NOT implemented beyond the safe fix pass)
- **ROUND A ×2** (my launch + the PREVIOUS session's Chris, which finally completed tonight) — BOTH verdict **YES**,
  both verified teach + Quick File actually file on the main PC's disk. Reports appended to
  `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md`. **Both independently flagged `0.0.0.0`-as-the-address as the #1
  connect blocker** → fixed in `edc1c03`.
- **The safe fix pass (`edc1c03`)** addressed: Quick File misfile (highest), the 0.0.0.0 address, the ID-code
  naming mismatch, and the connect-error/CA-jargon copy.
- **ROUND B** (reloaded the sandbox renderers from disk so the fixed files loaded) — **all four fixes LANDED, no
  new breakage.** (1) connect address now shows the real LAN IPv4s ("192.168.56.1 or 192.168.0.237") — the #1
  blocker closed; the status line no longer presents 0.0.0.0 as a URL. (2) "ID code" matches on both sides
  (disclosure "Security certificate & ID code", value "ID code 58:1E:6C:…"). (3) Quick File field-clear + plural —
  source-verified (the native file picker can't be scripted, so a LIVE submit is owed — one manual confirm). (4)
  plainer connect copy + a live bad-address test showed "Couldn't reach that PC. Check the address and port…" (no
  raw ETIMEDOUT). **Residual nit (out of scope):** the "listen on" bind INPUT still shows a bare `0.0.0.0` with no
  label — legitimate config, not the address to type, but a one-word label would remove the last doubt.
- **Deferred Chris cards (logged in NIGHT_RUN.md, NOT built — owner vet / bigger / delicate):** teach read-back
  not cleared on field advance (shows the previous field's value + a false "doesn't read like a date" — both runs;
  a delicate edit in the 2318-line shared wizard); teach page-jump on instruction-panel resize; doc-picker
  thumbnails blank over /v1; Quick File undo/where + live count refresh; cert "Needs re-issue" action button;
  32-block fingerprint compare UX (keep the check).

## Also logged for morning (approval-class or deliberately deferred)
- **Dead inline-workflow-provider tidy** (`searchWorkflow.js` `_provide` etc., DEAD since `9c50b93`): NOT done —
  it's a real refactor, not a snip (the whole render family is connected, `test_focus_repair.js` PINS the string
  `_focus(note)` which lives INSIDE the dead `_decisionBar`, and it's shared→client-synced). Cosmetic; do it
  deliberately, updating that pin.
- **D2 departments sweep** — NOT done: a partial departments visibility gate is UNSAFE (must be complete). Do the
  full slice deliberately (handover PART 2 finish path).
- **Client forced-change UX + contract bump (1.7.0→1.8.0)** for the /v1 A1 fix — deferred: the server 403 is the
  security boundary and needs neither; add the client screen + bump when you want the graceful client handling.

## Commands / state
- Pins: `npm run test:pins` (371 files, ~100s). One: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>`.
  The security pins: `.../electron src/services/test_device_import_gate.js`, `.../electron src/modules/api/test_v1_auth.js`.
- **Sandbox still running** (for a live S4 test / more Chris): core CDP **9223** (TLS `https://10.85.2.125:8765`,
  but reachable in-sandbox via `192.168.56.1:8765` — the 10.85 cert address isn't routable on that machine),
  client CDP **9224**, admin `chris`/`Chris-Test-9`. teach + Quick File + client-access ON in the sandbox.
- Live DB `%APPDATA%\ScanFinder\docusnap.db` BLOCKED to Claude's script tools. `/v1` DTOs path-free.

## Standing constraints (kept all night)
Plain non-technical explanations to the owner. Advisor + Oracle gate before/after a build (tonight's builds followed
already-signed Oracle conditions: A1 = eric's audit design, backup = gary, S4 = the design's C8-C14). Chris always
sandboxed; his findings never shipped without the owner's go (only the safe fix pass was done, per the owner's
night-run plan). DARK pattern for behaviour changes; nothing pushed/flipped/shipped.
