# Simpler server↔client connection setup — design (2026-09-14)

Status: SCOPED for advisor vet (eric = Electron/networking/UX; then the Oracle = security seam). Owner-driven.
Goal: make a search-client connect to the core in the fewest, plainest steps, **without weakening** the trust
posture. This is mostly a UX layer over machinery that already exists — not a security rewrite.

## The settled principle (why three earlier ideas were rejected — do NOT re-propose them)
Establishing trust for the FIRST connection over a network an attacker could control is unsolvable **on the
wire**. The client's check is only as strong as **how the client first learns the true certificate fingerprint**.
If that knowledge arrives over the same network the attacker controls, it is forgeable. Therefore, three owner
ideas were vetted and REJECTED, all for the same reason (recorded so they aren't revisited):
- **Broadcast the fingerprint on another/"silent" port** — same wire; a LAN man-in-the-middle sends their own
  broadcast with their own cert's fingerprint. No gain.
- **A second open port the client queries for the fingerprint** — same wire; the MITM answers that port too. No gain.
- **Store the real fingerprint encrypted in the server DB and match against it** — the attack intercepts the
  CONNECTION, never the server's disk; the client never reads the server's DB, it reads the network. Encryption
  at rest is irrelevant to a MITM.
The ONLY things that close the first-hello gap are a trust anchor **off the network** (the server SCREEN → a QR
or a short code; or a profile FILE the admin carries) or **pre-shared** (a pairing code a human carries). After
the first accept, the client **pins** the cert and every later connection is protected — that pin is the durable
half and it already exists.

## Threat model (kept honest)
- In scope: an operator on a trusted small-office LAN connecting a client to their core; a lost/typo'd address;
  a stale cert after a re-issue; the durable pinning that protects every connection after the first.
- Out of scope to "solve in code": an attacker ALREADY inside the LAN actively impersonating the core at the exact
  moment of a first connect. If that is happening the office is already deeply compromised. We MITIGATE it (show
  the fingerprint; offer QR/short-code/profile as the off-network anchor) but do not pretend to defeat it on the wire.

## What already exists (so the build is small) — grounded in the code
- Server `/v1`: OFF by default, LOOPBACK-only by default; `startApiServer` REFUSES a non-loopback bind without
  TLS (`handler.js:1521-1543`). Enabling a LAN host auto-runs `ensureManagedCert` (2-tier CA→server cert under
  userData/certs; `certService.js`); Settings "Managed certificate" panel shows status + **fingerprint**
  (`#client-api-cert-fp`) + Generate + **Export profile** (`buildConnectionProfile` → `{host,port,tls,
  caFingerprintSha256,caPem}`).
- Trust bootstrap: `GET /v1/ca` returns the CA PEM + fingerprint (NEVER the CA key), pairing-gated
  (`pairingOk`, `client_api_pairing_code`/`_expires`, constant-time compare). `POST /v1/enroll` = pairing →
  entitlement(402) → creds(401/429/MFA) → CA + session token + user.
- Client `apiClient.js`: `connect()` reads `/v1/health`; `fetchCa(code)` = one-shot UNTRUSTED bootstrap that
  returns caPem + fingerprint "confirm out-of-band before pinning" (TOFU); pins the **CA** on a keep-alive agent
  with `rejectUnauthorized:true`; supports **import-profile**. A connect / "Change server" screen exists.
So the flow already is: auto-cert on enable, CA-fetch-with-fingerprint (TOFU), optional pairing code, importable
profile, pin-the-CA. The work is to make the DEFAULT path fewer/plainer steps and add discovery.

## Proposed flow
### Server side (Settings → Search client)
1. **Gate the enable switch**: "Allow search-client connections" stays disabled until a host/hostname AND port
   are filled in (loopback `127.0.0.1` still allowed for same-machine, needs no cert). Clear helper text.
2. On enable with a LAN host: auto-generate the managed cert (exists). Then show, together, in ONE "Connect a
   client" card:
   - the **address + port**,
   - the cert **fingerprint** (exists),
   - a **short pairing code** (e.g. 6 digits, time-limited — reuse `client_api_pairing_code`/`_expires`; add a
     "New code" button + a countdown),
   - a **QR code** encoding `{host, port, fingerprint, code}` (rendered from those fields — a small OSS QR
     generator; see Open questions),
   - the existing **Export profile** button (the file is the no-camera, no-typing off-network anchor),
   - a **stable-address tip**: "For a reliable connection, give this PC a fixed address — a router DHCP
     reservation is easiest — or have clients connect by this PC's name. A changing IP makes clients lose the
     server." (The CLIENT never needs a static IP — it connects outward and its seat is keyed to a stored client
     id, not its IP; only the SERVER wants a stable address, because clients dial it and pin its cert's SANs.)
3. (Optional) **Advertise presence via mDNS** so clients can scan — a service record `_scanfinder._tcp` carrying
   host/port (NOT the fingerprint — discovery only; the fingerprint is still verified off-network). Off unless the
   server is LAN-enabled; a Settings toggle "Let clients find this PC on the network".

### Client side (Connect / Change server screen)
1. **Find the server** — two ways, offered side by side:
   - **Scan** (mDNS browse `_scanfinder._tcp`) → a list of found cores → pick one → host/port auto-filled; OR
   - **Type** the address + port by hand.
   - (Optional) **Scan/paste QR / Import profile** → fills host/port AND the expected fingerprint (+ code) in one
     shot — the smooth, verified path.
2. **Connect** → the client pulls the cert (`fetchCa`). Then:
   - If the expected fingerprint is known (from QR/profile) → **auto-verify**; on match, connect silently; on
     MISMATCH, a hard "this is NOT the server you set up — do not accept" stop.
   - Else (typed address, no QR) → show an **Accept** dialog that DISPLAYS the fingerprint ("check this matches the
     code on the office PC") + a field to optionally type the short pairing code. Accept → pin.
3. **Pin + log in**: pin the CA (exists), then the normal username/password (+ MFA) login. A later cert change
   (re-issue) → the pinned CA no longer matches → a distinct, deliberately cautious "**the server's ID changed —
   only accept if you were expecting this**" re-accept screen (never a silent re-pin).

## Trust model (stated plainly)
- Default = **TOFU with the fingerprint shown**, then **pin-after-accept** (durable protection for every later
  connection). Adequate for a trusted small office.
- The off-network anchors — **QR / short pairing code (off the server screen)** or the **profile file** — are the
  belt for the cautious and DO close the first-hello gap. They are optional but one click away.
- Dropping the pairing code from being MANDATORY is acceptable: the CA is not a secret (fetching it grants
  nothing), and login still needs credentials + a paid seat. Keep the pairing code available as the verification
  aid, not a hard prerequisite. (State this as a deliberate posture, for the Oracle.)

## Explicitly NOT built
The broadcast / second-port / encrypted-DB-fingerprint auto-checks (see the settled principle) — they add no
security against the first-hello MITM and would give false confidence.

## Open questions for eric + the Oracle
1. **mDNS on Windows without a native/AGPL dep**: is there a pure-JS, commercially-free zeroconf/mDNS lib
   (`multicast-dns` MIT? `bonjour-service` MIT?) that works reliably on Win11 with the firewall, no native build,
   no bundling headache — or is a small hand-rolled UDP-multicast advert simpler/safer? (eric.)
2. **QR generation**: a tiny commercially-free QR lib (e.g. `qrcode` MIT) rendered to a canvas/data-URI in the
   Settings renderer — any CSP/offline concern? (eric.)
3. **The cert-change re-accept UX** — the one genuinely dangerous screen. Copy + flow so a real cert rotation is
   easy but a MITM re-pin is scary. (eric → Oracle.)
4. **Auto-verify-from-QR seam**: when the QR carries the fingerprint, the client compares it to the `fetchCa`
   result BEFORE pinning; confirm there's no path where a bad cert gets pinned before the compare. (Oracle.)
5. **Pairing-code posture**: is "available but not mandatory" the right call, or should a first-ever enrol from a
   brand-new client still require the code once? (Oracle — the security seam.)
6. **Discovery information leak**: advertising `_scanfinder._tcp` tells the subnet a core exists. Acceptable on a
   trusted LAN (access stays login-gated), or make it opt-in only? (Oracle.)
7. **Loopback/same-machine** stays plain HTTP, no cert, no discovery — confirm the new UX doesn't force a cert
   path on the local case.

## eric's vet (2026-09-14) — networking/Electron/UX pass, applied
Verdict: **sound + correctly scoped as a UX layer.** Corrections + decisions:
- **NOT "reuse" — two small NEW builds:** (a) the **pairing-code WRITER does not exist** (`pairingOk` only READS
  `client_api_pairing_code`/`_expires`; no admin IPC/UI sets one) → S1 adds `client-api-pairing-generate`/`-clear`
  + countdown; (b) **a changed cert isn't detected as such today** (`reuseCa:true` keeps the pin valid across
  ordinary re-issues; a real CA change surfaces as a generic block, and `isNetworkError` doesn't match TLS-verify
  codes) → S2 adds `isCertError()` + a distinct `client-cert-changed` state + re-accept modal.
- **mDNS (S4): DEFER (recommend drop).** `bonjour-service` (MIT) is the lib IF ever built, but on Win11 it means a
  Defender **firewall prompt on BOTH PCs** (unsigned installer → scary/blockable), 5353 conflicts with Bonjour/
  iTunes/printer responders, a presence leak, and an **invisible fail-closed** ("found nothing") — to save typing
  one IP that import-profile/QR already eliminate. Disproportionate; import-profile is the one-click verified path.
- **QR: generate in MAIN** with `qrcode` (MIT) → `toDataURL` → `<img>` in the renderer (Settings CSP `img-src 'self'
  data:` allows it; keeps the lib out of the locked-down renderer). Payload = `{host,port,fingerprint,code}` ONLY,
  **never the CA PEM** (PEM → dense QR that photographs badly; the profile FILE carries the PEM). Client READS a QR
  with `jsQR` (Apache-2.0) via paste-image → `<canvas>` → `getImageData`. **Webcam NOT worth it** (client CSP has no
  `media-src`; Electron camera-permission + Windows consent = high lift, low value). Pragmatic set: **paste-QR-image
  + import-profile-file + type-short-code.**
- **Move the auto-verify COMPARE into MAIN (mis-layer fix):** a new `client-connect-verified({host,port,
  expectedFingerprint,code})` — main `fetchCa` → compute fingerprint in MAIN → compare to `expectedFingerprint` in
  MAIN → pin the caPem MAIN fetched (never one handed up from the renderer) → `connect()`. Removes the renderer's
  ability to supply BOTH cert and "expected" fingerprint on the verified path. Keep the explicit "Choose .crt…"
  path renderer-fed (a deliberate operator choice). **Replace `window.confirm` with a styled modal** (first-accept
  AND cert-change — `confirm()` can't show an old-vs-new diff). Keep `fetchCa`/`enroll` in main.
- **Cert-change re-accept lives in MAIN**, refuse-is-the-default button; **seam:** its meaning RELIES on the CA
  staying stable across ordinary re-issues (`reuseCa:true`) — keep CA regeneration rare/deliberate or the alarm
  becomes fatigue. On a cert error against a saved server, main re-`fetchCa`s the NEW fingerprint, shows old-vs-new,
  re-pins ONLY on explicit confirm.
- **Loopback confirmed cert-free** ("Use HTTPS" defaults off; `ensureManagedCert` no-ops for 127.0.0.1; env path
  bypasses the UI). Watch: the enable gate must treat `127.0.0.1` as a valid cert-free host (today an empty host
  silently defaults to loopback); never make QR/discovery/pairing a PREREQUISITE for connect (would break the env
  path + the sandbox + the same-machine add-on).
- **Effort:** S1 ~1 day · S2 ~1–1.5 days · S3 ~0.5–1 day · S4 ~1–2 days (disproportionate). Valuable core = S1–S3
  (~2.5–3.5 days). Licences to re-check via `scripts/check-licenses.js` when added: `qrcode`/`bonjour-service`/
  `multicast-dns`/`dns-packet` MIT, `jsQR` Apache-2.0. `qrcode` = core dep, `jsQR` = client dep.
- **Deferred to the Oracle (security seam):** `pairingOk` **defaults OPEN when no code is set** (`handler.js:1684`)
  — so today, with no code configured, `/v1/ca` + `/v1/enroll` are ungated (login creds still required) — is
  "pairing available but not mandatory" acceptable, or must a first-ever enrol require the code once? Plus the
  auto-verify "no bad cert pinned before the compare" guarantee (Q4) and the discovery presence-leak (Q6).

## Oracle vet (2026-09-14) — SIGN OFF WITH CONDITIONS (`docs/oracle_log.md`)
Design sound + correctly scoped as a UX layer; the settled principle + the three rejections are correct; the
threat model is honest; eric's compare-in-MAIN is the right fix and is **STRONGER than today** (today's
import-profile pins whatever caPem the file holds with NO machine compare, and TOFU uses a raw `window.confirm`).
Fork rulings: pairing "not mandatory" = **ACCEPTABLE** (it is today's shipped posture, not a new regression —
keep the lever real); mDNS/S4 = **CONCUR DEFER** (opt-in only if ever built).
**The seam eric couldn't see — a SAN gap masquerading as a CA change:** the pinned agent verifies BOTH the CA
chain AND the dialed hostname against the server-cert SANs (`managedSans` = the addresses the SERVER enumerated).
A client dialing an address NOT in the SANs (a 2nd NIC/VPN IP, a typed FQDN, a `.local` name — MUCH more likely
if mDNS ever advertises a name the server didn't SAN) gets `ERR_TLS_CERT_ALTNAME_INVALID` with an **UNCHANGED CA
fingerprint** → eric's cert-change flow would fire the "server identity changed" alarm whose two fingerprints
MATCH → trains users to click through the one screen that must stay scary. Must branch on the error code (C3).
Fails closed (never mis-pins), so a condition, not a send-back.
**Conditions — BUILD:**
- **C1** the verified path is fully MAIN-resident: `client-connect-verified({host,port,expectedFingerprint,code})`
  — MAIN fetches the CA, computes the fingerprint, compares, and pins **the exact bytes MAIN fetched**; NO caPem
  round-trip through the renderer. For import-profile *verified*, pin the profile's caPem IN MAIN. The explicit
  "Choose .crt…" path stays renderer-fed (the sole deliberate-operator exception).
- **C2** compare the **locally-computed** fingerprint of the exact pinned bytes — NEVER the server-reported
  `caFingerprintSha256` (`apiClient.js:248-249`); if `new X509Certificate(pem)` throws → treat as MISMATCH + refuse
  (never "fail closed by luck"). Guarantee: *pinned bytes ≡ hashed bytes ≡ compared value.*
- **C3** add `isCertError()` (covers `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` /
  `DEPTH_ZERO_SELF_SIGNED_CERT` / `ERR_TLS_CERT_ALTNAME_INVALID` / `CERT_HAS_EXPIRED` / `ERR_SSL_*`) routed BEFORE
  `isNetworkError` (`main.js:383`). ALTNAME with an **unchanged** CA → a "certificate doesn't cover this address —
  re-issue on the server / use the advertised address" state (fail-closed, NO re-pin offered), NOT the
  identity-changed re-accept. Only a genuinely changed CA fingerprint reaches the refuse-is-default re-accept
  modal. NEVER a `rejectUnauthorized:false` / `checkServerIdentity` bypass as the ALTNAME "fix".
- **C4** keep the pairing lever real + honestly labelled: the S1 writer lets an admin set/clear a code (setting a
  code = mandatory pairing on `/v1/ca`+`/v1/enroll`, the existing mechanism); raise it to ≥8 alnum OR add a
  failed-pairing lockout on those routes (a 6-digit code is a 403/200 brute-force oracle today, checked before
  rate-limiting); label it a **verification aid**, not the access control (the real gate = credentials + entitlement
  + seat). NEVER mandatory-by-default (would break the env/sandbox/harness enrol paths).
- **C5** the "enable requires host/port" gate is a Settings/renderer guard ONLY — no server-side hard requirement
  in `resolveApiConfig`/`startApiServer`; the env path (`SCANFINDER_API`), the sandbox, and loopback `127.0.0.1`
  (cert-free) must keep working. Treat `127.0.0.1` as a valid cert-free selection.
**Conditions — TEST (each must genuinely FAIL on the bug it guards):**
- **T1 (C2)** MITM `{caPem: attackerCA, caFingerprintSha256: victimFp}` on a verified connect with
  `expectedFingerprint=victimFp` → REFUSE + attackerCA NOT pinned; malformed PEM + matching server-reported fp →
  REFUSE, nothing pinned.
- **T2 (C3)** host absent from the SANs → "address not covered" state, no re-pin, re-accept modal NOT shown; a
  genuine CA change → re-accept modal, refuse-default, pins only on explicit confirm; a TLS-verify error classifies
  as `isCertError` not `isNetworkError`.
- **T3 (C4, PIN)** no code → `/v1/ca`=200 and `/v1/enroll` still enforces creds+entitlement+seat; code set → both
  require a matching `?code=` (constant-time) — pins the default so a future dev can't silently flip pairing.
- **T4** the S4/mDNS advert stays absent (or if built: default OFF, host/port only — NEVER the fingerprint — and
  connect never depends on it).

## Slices (once vetted)
- S1 — server: gate the enable switch on host/port; the unified "Connect a client" card (address + fingerprint +
  short code + QR + export profile).
- S2 — client: Connect screen with type-or-scan + accept-with-fingerprint (+ optional code) + pin; the cautious
  cert-change re-accept.
- S3 — QR/profile auto-verify path (scan/paste/import → auto-check fingerprint).
- S4 — mDNS advertise (server) + scan (client), opt-in.
