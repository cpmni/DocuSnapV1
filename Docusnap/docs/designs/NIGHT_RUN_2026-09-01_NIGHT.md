# NIGHT RUN — 2026-09-01 NIGHT (armed by the owner "going to bed")

> Autonomy protocol (standing, owner 2026-08-30): runs on auto, never waits; advisors + Oracle free
> (parallel when independent); **Chris ALWAYS sandboxed** (a COPY, never the live app/DB/Desktop; cards
> logged, never implemented tonight); anything needing owner approval → LOGGED under "NEEDS YOUR APPROVAL
> (morning)" in the handover + SKIPPED (live flips, push, live-DB/app/Desktop writes, non-DARK changes,
> new deps, licensing/legal/backend/website, deletes outside scratch/sandbox, implementing a Chris card);
> anything dangerous → agents first (gary/eric → Oracle), no safe route ⇒ that item STOPS.

## THE JOB (owner order): #1 + #2 combined, THEN a full security audit.

### #1 — Quick Reprocess INTEGRATION GATE (autonomous, self-built warm sandbox)
Quick Reprocess is BUILT DARK (`8ec97fd` foundation + `7a8b797` slices 4-7; pure merge pinned 68/68 in
`test_quick_reprocess_merge.js`). What's unproven = the END-TO-END path (real Python `--reextract`, real
`ocr_recipe` stamps, real batch partition + imageless merge). The owner's real warm learned DB is NOT on
this machine (live DB = a reset TEST DB, ~50 confirmed, 0 taught templates), so the gate BUILDS ITS OWN
warm sandbox from `Desktop\ScanFinder Test Corpus` (605 papers + `ground_truth.json`), touches NO live
originals, makes NO live flips. Design = gary's report (consulted tonight), Oracle-vetted before running.
Required arms (from `HANDOVER_2026-09-01_EVENING.md` §"GATE before merge"):
- switch OFF (`quick_reprocess_enabled` unset) == today, byte-identical.
- warmed-copy Quick-vs-Full: values + BINDINGS (template_id / supplier_name / document_type_id /
  detected_type_name) + hold/note sets + `isAutoFileEligible` + would-file parity; deficits itemised
  (the honest pixel-heal price); **M=0** (no NEW silent-wrong auto-file).
- Quick×2 == Quick×1 idempotence.
- C3 self-heal: a Full-fallback doc inside a Quick batch earns a fresh `ocr_recipe` stamp.
- C1 contested-keep fires end-to-end when an image-family read disagrees with the fresh text.
Each arm carries a NON-VACUITY check (a green that proves nothing is worthless — name the check per arm).
Honest limitation to record: this sandbox cannot substitute for the owner's real Castellan-taught DB.

### #2 — Chris sandboxed round (`/christest`)
Full end-to-end customer vet on a COPY. Focus the newest surfaces on top of the usual cold-import / teach
/ File-All / scary-button battery: (a) the Quick vs Full "Reprocess all" dialog copy IF enabled in the
sandbox (the feature is DARK — enable it in the sandbox DB only to vet the wording; never touches live);
(b) the batch-import low-memory copy; (c) the DB-encryption opt-in ceremony + Unlock/Recover copy; (d) the
open "ready"-language + heading-guess-issuer cards. YES/NO verdict → `docs/CHRIS_FULL_APP_REVIEW_<date>.md`;
cards logged, not implemented.

### #3 — FULL SECURITY AUDIT (owner ask — pre-release, "very security conscious")
Advisors consulted in parallel tonight: **eric** (Electron 44 attack surface — webPreferences, preload/
contextBridge, IPC input validation + path-traversal, navigation/openExternal allowlists, CSP, fuses/ASAR/
signing, version-specific CVE exposure), **a security researcher** (dependency/known-CVE sweep — npm prod
tree + client + vendored python; node-forge / pdfium / better-sqlite3-multiple-ciphers / argon2 CVE classes;
untrusted-input parsers; JS footguns), **gary** (raw-OCR-DATA-AT-REST assessment — where OCR text + working
copies + temp slices + logs live on disk, whether they should be encrypted/cleaned). Main Claude audits the
LICENSING system directly (offline token verify, replay, fingerprint, backend). Oracle adjudicates blast
radius + names what BLOCKS full release vs. acceptable-with-note. Findings → `docs/SECURITY_REVIEW_2026-09-01.md`.
Any FIX that is DARK/safe/non-approval-class may be built + pinned tonight; anything approval-class
(licensing/backend/website changes, new deps, non-DARK behaviour changes, signing) → logged for the morning.

## DELIVERABLES (morning)
- `docs/SECURITY_REVIEW_2026-09-01.md` — ranked findings, CONFIRMED vs SUSPECTED, BLOCKS-release vs note.
- Quick-Reprocess integration gate report (arms + verdict + non-vacuity + honest limits).
- `docs/CHRIS_FULL_APP_REVIEW_<date>.md` — Chris verdict + cards.
- `HANDOVER_2026-09-02.md` — everything, with a "NEEDS YOUR APPROVAL (morning)" section.
- This file moved to the NIGHT_RUN.md DONE ledger with results + "repeat if".
