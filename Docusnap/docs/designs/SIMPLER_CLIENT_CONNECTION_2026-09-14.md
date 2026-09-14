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
   - the existing **Export profile** button (the file is the no-camera, no-typing off-network anchor).
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

## Slices (once vetted)
- S1 — server: gate the enable switch on host/port; the unified "Connect a client" card (address + fingerprint +
  short code + QR + export profile).
- S2 — client: Connect screen with type-or-scan + accept-with-fingerprint (+ optional code) + pin; the cautious
  cert-change re-accept.
- S3 — QR/profile auto-verify path (scan/paste/import → auto-check fingerprint).
- S4 — mDNS advertise (server) + scan (client), opt-in.
