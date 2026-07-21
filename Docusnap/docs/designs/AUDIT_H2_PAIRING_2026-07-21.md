# AUDIT H2 — First-contact enrolment TOFU / dead pairing fence (DESIGN + OWNER DECISION)

**Severity:** HIGH (LAN add-on only; add-on OFF by default). **Status:** design + log — NOT built this run.
**Why not built autonomously:** the smallest real fix is a **feature** (a pairing code end-to-end across client + core + Settings UI + IPC) with a UX surface, and there is a genuine owner choice (ship-the-feature vs interim-lockdown) that changes what code is written. Building it blind risks the wrong half. This overlaps the backlog **SEC-04** item (eric-designed, "client transport+IPC already thread `code`, ship CLIENT field first then core").

## The finding (verified, from `SECURITY_AUDIT_2026-07-21.md` H2)
- `client/apiClient.js:191,205` issue the CA-fetch and enroll requests with `{ insecure:true }` → `rejectUnauthorized=false` (`:79-81`): TLS verification is OFF for bootstrap and the *displayed* fingerprint is whatever the server sends. The only defence is a human comparing a 64-hex string in a `window.confirm` (`renderer.js:263-268`).
- The server pairing fence `pairingOk` returns `{ok:true}` when no code is set (`api/handler.js:1050`), and `client_api_pairing_code` is **written nowhere in the product** (grep finds only tests) — no Settings UI, IPC, or generator. Even if an admin set it by hand, the shipped client sends no `code` on fetch-CA (`renderer.js:261`), so `/v1/ca` would 403. No attempt counter.
- **Attack:** on a LAN with the add-on enabled, an on-path attacker answers the new client's fetch-CA (verification off) with their own CA, proxies `/v1/ca` to the real server, and the user OKs the attacker's fingerprint → the rogue CA is pinned; every later request (incl. `/v1/auth/login`) terminates at the attacker → persistent MITM, captured credentials + TOTP.
- **Preconditions:** add-on enabled + bound to non-loopback; attacker on-path at the exact pairing moment; user clicks OK without comparing.

## Two fix paths (owner to choose)

### Path A — INTERIM lockdown (small, no new feature; ship first)
Removes the dangerous automatic-TOFU path without building the code UI:
1. **Disable the client "Fetch certificate" button** on non-loopback targets; make **profile-import the only supported pairing path** (admin exports the CA profile from the core box on trusted media / share). Document it as the supported flow.
2. Keep the fingerprint-compare confirm as a secondary check for the loopback/dev case only.
- **Pro:** kills the auto-TOFU MITM window with a UI disable + docs; no crypto/protocol work. **Con:** worse UX (manual profile transfer); not the end state.

### Path B — FULL pairing code end-to-end (the real fix; SEC-04)
1. **Generate** a short-lived, high-entropy pairing code on `client-api-set-enabled` (core); **surface it in Settings → Search client** beside the CA fingerprint (copyable, regenerate, TTL shown).
2. **Require** it (server-side) for `/v1/ca` and `/v1/enroll` on non-loopback binds, with a **per-IP attempt counter** + lockout (`pairingOk` must stop returning `{ok:true}` when unset on a non-loopback bind — invert the default to fail-closed).
3. **Thread it through the client connect screen** (`renderer.js:261` fetch-CA must send `code`; the client plumbing already accepts `code` per the audit + SEC-04 note).
4. Bind the fingerprint compare as belt-and-braces on top.
- **Pro:** the correct end state — an on-path attacker without the out-of-band code cannot enrol, and the per-IP counter stops guessing. **Con:** a real multi-file feature (core generator + IPC + Settings UI + server gate + client field), effort ~M; needs an owner click-through + a two-machine pairing test.

## Recommendation
Ship **Path A interim now** (when the add-on nears launch) to close the live MITM window cheaply, then **Path B** as the launch-blocker before the add-on ships to anyone (it is already on the "Do before launch" list and overlaps SEC-04). Neither is a safe *blind* autonomous build tonight: Path A needs an owner UX call on disabling a shipped button + the profile-import doc; Path B needs owner UX + a two-machine test. **The add-on is OFF by default, so there is no live exposure today** — this is correctly a before-launch item, logged for the owner.

## Related / cross-refs
- `SECURITY_BACKLOG.md` **SEC-04** (dead pairing gate) — same root; eric-designed; "ship CLIENT field first then core"; also folds in that `backupService._settingExcluded` only filters `licens`, so a pairing code would ride out in backups (see the audit backlog "invert the backup filter to an allowlist").
- Audit H1 (`ca.key` at rest) is the paired transport-security item — being built this run (kill-switched, backward-compat).
