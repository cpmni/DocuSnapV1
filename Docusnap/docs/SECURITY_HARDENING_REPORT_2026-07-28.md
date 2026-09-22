# ScanFinder — Security Hardening Report
**Date:** 2026-07-28 · **Branch:** `feat/reprocess-throughput-autostraighten` · **Status:** all shipped
work pushed to origin (`d9cd5cf..374426a`).

> Scope note: this is a plain-language outcomes report. It deliberately contains **no exploit recipes** —
> the concrete attack paths live only in the gitignored `SECURITY_AUDIT_2026-07-27_LOCAL.md`, which is
> never committed.

---

## 1. Short answer first
We worked through a staged security remediation of ScanFinder. This session closed the audit-integrity
gap, added tamper-evidence to the audit log, made the offline-licence time anchor tamper-resistant, laid
inert groundwork for future per-document-type permissions, and settled the code-signing direction
(reject IV, use the Microsoft Store path or register the company). Every change was **kill-switched or
inert** (off ⇒ byte-identical), **fail-safe by construction** (a failure never locks out or silently
passes), reviewed by the Oracle adversarial gate, and covered by tests. **The big remaining item —
encrypting the data at rest — is built as a spike but needs your supervision to finish (native dependency
+ a one-time re-encrypt), so it is not done yet.**

---

## 2. What shipped this session (ledger)

| Stage | Commit | Theme | Behaviour today | Gate |
|---|---|---|---|---|
| 1 | `2cb57e2` | Critical file-handling exploit closure | ON (fixes) | tests + Oracle |
| 2 | `9b5d512` | Privilege / exfiltration / DoS hardening | ON (fixes) | tests + Oracle |
| 3a | `4c85337` | Per-machine install (Program Files, not user-writable) | build config | — |
| 4 (M5) | `a3ff72e` | Verify the backup-import licence token | ON | tests + Oracle |
| 6a (spike) | `eea72a0` | Whole-DB encryption — proof of concept only | dark | design |
| 5a | `d9cd5cf` | Audit coverage of destructive admin actions | ON | tests |
| 5b | `3694e74` | Tamper-evident audit chain | ON, fail-safe | tests + Oracle |
| 8 | `ee198cc` | Per-doc-type authorization groundwork | **inert** | tests |
| 6c | `ae34aed` | Integrity-stamp the offline-licence time anchor | ON, fail-open | tests + Oracle |
| — | `374426a` | Code-signing / Store publisher-identity decision (doc) | doc | — |

The four items detailed below are this session's focus; 1/2/3a/4/6a-spike were reported earlier and are
summarised in the memory record `project_security_remediation_20260727`.

---

## 3. The work, and what each means for the app

### 3.1 Audit integrity (Stage 5)
**The problem.** The audit log is the record of who did what — deletes, merges, learning resets,
watch-folder changes. Two gaps: many destructive admin actions wrote **no** audit row at all, and the
log itself could be silently edited or wiped, so the record couldn't be trusted as evidence.

**5a — Coverage (`d9cd5cf`).** Every destructive template, field, learning-reset and watch-folder handler
now writes an audit entry.
*What it means for the app:* nothing an administrator does destructively is invisible any more — there is
always a row saying it happened, who did it, and when.

**5b — Tamper-evidence (`3694e74`).** Each audit row is now cryptographically chained to the one before it
(a keyed HMAC "hash chain"), and the table is append-only at the database level (edits and casual deletes
are blocked). An admin can press **Settings → Audit → Verify integrity** to re-check the whole chain,
including archived months.
*What it means for the app:* if anyone tampers with the history — edits a row, reorders it, or deletes a
chunk — it is now **detectable**, not silent. A trivial "wipe the log" is blocked outright.
*Two things worth noting from the build:* the Oracle review caught a real flaw in my first version — the
verifier could be fooled into reporting "all good" on a doctored log — and we fixed it to fail loudly
instead. We also found and fixed a latent bug that could have silently switched the chain off on some
installs. Both are pinned by tests so they can't come back.

### 3.2 Authorization groundwork (Stage 8, `ee198cc`) — *inert, no behaviour change*
**What it is.** A scaffold so that, later, an admin could restrict which staff roles see which **document
types** (e.g. reception sees Delivery Notes but not Invoices). This session added only the empty database
table and a clearly-named "seam" in the single permission checkpoint — it does nothing yet.
*What it means for the app:* **zero change today** (proven byte-identical). It means the future feature is
a small, safe addition in one place rather than a risky re-architecture of the permission system.

### 3.3 Offline-licence time anchor (Stage 6c, `ae34aed`)
**Background.** To stop someone winding their PC clock back to extend a trial, the app keeps a "high-water
mark" of the latest time it has seen, mirrored to a file outside the main database. That file was plain
text.

**What we did.** The file is now stamped with a fingerprint-keyed signature, so a copy taken from another
machine, or a hand-edit, is rejected. It stays **fail-open**: any bad/foreign/corrupt stamp is simply
ignored, never treated as a lockout — the one direction that actually matters, because a wrong "lock"
would shut a paying customer out offline.
*What it means for the app — stated honestly (Oracle's correction):* this is **not** a fix for the
trial-reset trick itself (deleting the file still defeats that — that residual stays on the to-do list).
Its real value is **brick-containment**: a cloned or disk-imaged install can no longer carry a bad
high-value anchor onto a second machine and lock *it* out. Plus it raises the effort of a casual edit.

### 3.4 Code-signing / distribution decision (`374426a`, doc only)
**The question you raised:** you have no cert yet and aren't registered — would an IV (individual) cert
work?
**The answer we settled and recorded:** an IV cert would put **your personal legal name** on the
installer's publisher field (the Windows "verified publisher" prompt and file properties), which breaks
the project's hard rule of never surfacing the proprietor's name. So **IV is rejected.** The
**Microsoft Store (MSIX)** path is the name-safe option — Microsoft re-signs with an opaque account ID, so
the signature never carries your name, and the public display name can be "Six Mile Software." A
reservation checklist is now in `MSIX_SETUP.md §0.1`, including the one policy point to confirm at signup
(whether an *individual* Store account accepts "Six Mile Software" as the display name, or forces your
legal name → in which case register the company). OV/EV certs remain viable **after** the company is
registered.

---

## 4. How we know it is right
- **Kill-switched or inert.** Behaviour-changing security fixes carry an off-switch that restores the exact
  prior behaviour byte-for-byte; the groundwork (Stage 8) is inert with the switch off *and* on. This lets
  us prove we changed only what we intended.
- **Fail-safe direction.** The audit chain fails **loud** (a doctored log reports failure, never a false
  "OK"); the licence anchor fails **open** (a bad stamp is ignored, never a lockout). Each was chosen for
  the direction where the wrong answer would hurt.
- **Adversarial review.** Each substantive change passed the Oracle gate, which is specifically there to
  find the seam where two correct-looking changes combine badly. It sent Stage 5b back once (we fixed the
  flaw) and signed off 6c with two conditions (both applied).
- **Tests.** New and existing suites are green — the audit chain (25 checks incl. the tamper cases), the
  audit coverage/archive suites, the access-control matrix (37 checks), and the time-anchor suite (37
  checks incl. the fail-safe lockout pins).

---

## 5. Honest limits — where risk still lies
Stated plainly, because pretending otherwise is worse than the gap:
- **Data at rest is still not encrypted.** OCR text and extracted values sit in a readable database until
  **Stage 6a** (whole-DB encryption) is finished. The spike proves the approach; the real thing needs a
  native-dependency swap and a one-time re-encrypt of the live database — **owner-supervised**, not run
  unattended. This is the single biggest outstanding item.
- **A same-user attacker with the keys can still forge.** The audit chain and the anchor stamp are keyed
  by secrets held for the logged-in Windows user. Someone who *is* that user, with the right tools, can
  still forge a *consistent* record. What we deliver is **detection of tampering by anything without the
  key** — bugs, partial compromise, a casual editor, a copied database. Signing (3c) and encryption (6a)
  raise that bar further.
- **Audit tail-truncation.** Deleting the very newest rows leaves a shorter-but-valid chain with no
  successor to flag it. Detecting that needs an external anchor (e.g. periodic export of the chain head) —
  out of this stage's scope, noted.
- **Trial-rollback residual.** Deleting the licence anchor file still defeats the clock-rollback trial
  trick; 6c did not close that (it was never claimed to). Tracked as an open follow-up.
- **Installer is unsigned.** Until the Store path or a cert lands, Windows SmartScreen shows "Run anyway."
  No data risk; a trust/first-impression cost.

---

## 6. What's next (all owner-gated)
| Item | Needs from you |
|---|---|
| **6a** whole-DB encryption (the big one) | approve + supervise the native-dep install and one-time live re-encrypt |
| **6b / 7** working-copy encryption + licensing hardening | follow 6a |
| **3c** code-signing | register the company **or** confirm the individual Store account name policy |
| **3b** fuses + asar full smoke | one live launch of every window to confirm |
| SEC-05 rollback residual + audit tail-anchor | small follow-ups, whenever |

Everything autonomous-safe is complete and pushed. State is recorded in the memory note
`project_security_remediation_20260727`; the staged plan is in `.claude/plans/`.
