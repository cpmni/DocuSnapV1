# HANDOVER — 2026-08-31 EVENING (the full-day session: night run → three arcs → three signed designs)

**Branch** `feat/teach-side-overnight`. **Origin is at `0ddd268`** (the owner pushed twice today:
`c876308`, then `0ddd268`). **Local ahead, NOT pushed:** `655f915` (stale blind-geom doc fix),
`9575883` (the three Oracle design verdicts + queue), + this wrap commit — owner reviews then
pushes. Tree clean apart from the usual untracked handovers.

## What this session shipped (all committed; chronological)

1. **The adversarial night run** — Hard Set corpus (400 PDFs), 3-arm scoring (0 wrong would-files),
   three advisor class cards, Chris round (verdict YES). → `HANDOVER_2026-08-31_MORNING.md`.
2. **Day-2 rebuilds** — practice run reworked TEACH-FIRST (`3e47cd4`), the full 20-page User Guide
   (`2a9b4d7`), Chris round 2 (verdicts YES ×2; his 4 build defects fixed same night `c2b2281`).
3. **The three Hard Set cards BUILT, Oracle-cycled, gated** (`ece65b1`+`829afed` cell-below ·
   `9dd5139`+`e0fe39d` money-sign parens/CR · `5d1dd84`+`f72eee5` buyer-issued convention note) —
   evidence dossier `docs/designs/DARK_ARCS_GATES_2026-08-31.md`; every realdoc arm byte-identical,
   M=7 unchanged. **FLIPPED LIVE by the owner's instruction**, then **mig 98 (`0ddd268`)**
   UPSERT-forces all six gated switches ON for every install (the 4 arcs + `reslice_witness_sweep`
   + `corrob_discount_invalid_witness`; `template_format_fail_yield_strict_money` NEVER — Oracle
   C10/C11).
4. **Live import demo** — 20 boxed-cell scans through the real app: 20/20 refs + 20/20 dates
   filled, all held correctly; deleted + purged + zero learning strays afterwards.
5. **Terms FINAL** (`127ec74`): the owner's checked text + product-fit additions;
   `LEGAL_VERSION 2026-08-31`; draft banner gone.
6. **Installer built**: `dist\ScanFinder Setup 2.0.0-r20260831-1247-0ddd268.exe` (315 MB, includes
   mig 98) — the owner is testing it on a second machine. SmartScreen "Run anyway"; trial needs
   internet once.
7. **Three afternoon design rounds, all Oracle SIGN-OFF-WITH-CONDITIONS, NOTHING BUILT** — the
   next session's job (below). Verdict trail: `docs/oracle_log.md` (three 2026-08-31 entries at
   the foot). Queue entries: `NIGHT_RUN.md`.

## ⏭ NEXT SESSION'S JOB — build whichever design(s) the owner picks

The full advisor cards live in the 08-31 session transcript; **everything needed to build is
condensed here + the oracle_log conditions.** Each is DARK, own switch, advisor-precedent plumbing
(env bridge in `_reconcileEnv`, mig seed OFF, dev-gated Settings row in `DEV_SWITCH_IDS`).

### Design 1 — `TEMPLATE_LOCATE_ROLE_QUALIFIER` (the Net-Total locate steal; owner exhibit Castellan credit_note_0008)
- **Mechanism (verified):** `_label_score` (template_mapper.py:3588-3653, shared by Stage 0.5 AND
  Stage 2 via anchor.py:2319-2326) scores a boundary-aligned whole-needle occurrence 1.0 — a SPACE
  is a boundary, so bare 'total' hits "net total" at full score; the proximity tie-break
  (:3444-3477) or a clipped search window (`_expand_box` :3561-3569, min 0.06 page) then locks the
  wrong row. The totals block genuinely floats per-doc (two taught rows 0.035 apart). The teach is
  clean — do NOT re-teach.
- **Build:** inside `_locate_anchor` (NOT caller-side — the page-wide retry re-imports the bug):
  for a needle that normalises to bare 'total' (strip edge caption punctuation as :3624 does, so a
  taught "Total:" arms), partition floor-clearing candidates: a line is QUALIFIED iff every
  boundary-aligned 'total' occurrence fails `keyword._total_role_collision` (REUSE the frozensets
  verbatim — precede {sub,net,goods,gross}, follow {vat,tax,gst,discount,shipping,freight,
  carriage,surcharge,handling}; 'grand'/'amount'/'due' deliberately unstopped). PREFER unqualified
  before the proximity key — DEMOTE never veto. When the LOCAL pass's only hits are qualified →
  treat as not-found → the page-wide pass (same preference). Twin site: born-digital
  `_locate_in_text_lines` (anchor.py:2206-2246) + a pinned decision on its missing page-wide leg.
- **Oracle conditions (log entry has all 8):** the CARRIERS override (template_mapper.py:3471-3476;
  fed by anchor.py:677-693 passing a drifted rigid money read as confirm_value) must not
  short-circuit an armed needle's all-qualified carrier set — fall back to the preferred floor
  set; RED-first end-to-end Castellan pin asserting **committed −1,578.24, sign intact, NO
  recon-adjust note**, through the drift+`_RELOC_TOL` path with app-env switches; the divergence
  pin ("Net Total / VAT / Invoice Total" fixture — goes RED under an any-preceding-word rule);
  vocab-identity pin (import, don't copy); realdoc-605 OFF==ON + ON-arm full enumeration
  (would-files, corrob agree↔disagree flips, landmark diffs, 0 new wrong totals, M=7); a
  combined-arm census with the reslice sweep (Nordwind 20 incl. 0023); flip order AFTER
  sweep/discount.

### Design 2 — `TEMPLATE_FRAGMENT_CONTAINMENT_YIELD` (the CAD8 exhibit; Castellan delivery_note_0005)
- **Mechanism (verified):** mapping>label precedence is PINNED WAD (engine.py:8176/:8261-8263).
  The mapper's `_pick_fuller_code` disagreement branch (template_mapper.py:1586-1593) committed
  the inline fragment 'CAD8' with an UNCONDITIONAL false shapewarn (the rb_531 class); the
  truncation source is `_read_inline_box`'s `split()[0]` trim (:1457-1458 — prefix-only by
  construction). Every existing healer traced non-firing for structural reasons (gary's card;
  notably `template_format_fail_yield` declined because 'CAD8' PASSES the hard reference_code
  pattern, and BLIND_GEOM_DISAGREE_RECONCILE is ON-since-08-01 but scoped `anchor_registration`
  exactly). The 08-09 Oracle explicitly reserved THIS fix as a separate owner-gated arc.
- **Build:** a new sibling leg in the Stage-1 mapping-protection block immediately after the
  format-fail-yield leg (~engine.py:8243), same idiom as the date-invalid/blind-reg legs. Trigger
  (ALL): existing method startswith 'template_mapping'; ref-family key (`_is_ref_field(key) or
  key.endswith('_ref')` — engine.py:2902 pair), NOT date, not name-like, **NEVER currency/total
  role** (copy class F's role test engine.py:4011-4016; cite C10/C11 + database/index.js:2314);
  challenger keyword/keyword_override conf ≥ 85 AND `not _stage05_format_fails(challenger)`;
  STRICT prefix containment on ONE stated normaliser (`_code_norm` family; core ≥ 4 chars,
  pinned separator example 'CAD-832694' vs 'CAD8'). Action: adopt challenger capped at
  `_CONFLICT_CAP` 88 + a NEUTRAL note naming BOTH values ("The taught box read 'X'; the field's
  label read the longer 'Y'. Kept the longer read — please confirm." — NO causal "cut short"
  claim) + `continue`; method stays keyword (never re-grants the taught exemption).
- **Oracle conditions (log entry has C1-C8):** the note must NEVER enter
  `_verification_doubt_note_marks` (pin `_is_verification_doubt_note(new)==False` + a comment at
  engine.py:1851); amend `test_stage05_format_yield.py`'s docstring/labels to name this sanctioned
  exception (helper checks stay byte-identical); prefix-only v1 pinned as a trade-off; pin proven
  to FAIL with the leg deleted; realdoc-605 with every hold-set LEAVER enumerated + eyeballed;
  the Castellan five as fixtures (0005 heals, 4 siblings byte-identical); a clipped-code class
  into gen_hard_set.py. Queued separately: the one-off OCR probe of 0005's saved inline slice
  (which sub-path split the token).

### Design 3 — DB-at-rest encryption (the owner's ask: docusnap.db is text-editor readable)
- **Consensus:** `better-sqlite3-multiple-ciphers` as a package.json ALIAS ("better-sqlite3":
  "npm:better-sqlite3-multiple-ciphers@^12"); ChaCha20 + RAW 256-bit `PRAGMA hexkey` (no KDF);
  `.db-key` beside the DB DPAPI-wrapped via `secretStore` + a one-time printed RECOVERY KEY
  (`.db-recovery` = key under argon2id(code)) on the final onboarding card — NO daily password
  (login lives inside the DB; headless /v1+tray; forgotten passphrase = permanent loss). Prior
  art: `docs/designs/STAGE6A_ENCRYPTION_SPIKE_2026-07-27.md` + proven `scripts/spike_key_wrap.js`
  + `src/lib/auditKey.js` pattern. Production Python NEVER opens the DB (verified). Migration =
  gary's manifest state machine: checkpoint(TRUNCATE) → db.backup .pre-encrypt → **hexrekey on
  the copy** (ATTACH+export DELETED from the design) → verify (integrity + sentinel counts +
  NEGATIVE CONTROL: open WITHOUT key must FAIL + header magic absent) → crash-ordered rename
  swap; every crash state resolves to a working DB; ambiguity → the surviving plaintext.
- **Slices:** 0 = dep swap alone (gates: suites + realdoc-605 byte-identical + check-licenses +
  a PACKAGED build boot proving the alias rebuilds); 1 = key infra dark (fail-CLOSED write mode —
  secretStore's by-design fail-open would silently mint a PLAINTEXT keyfile; assert 32-byte key;
  pre-ready guard; Unlock/Recover window, license-window pattern, no equal-weight "start fresh");
  2 = opt-in migration (crash matrix incl. kill-during-rekey + EBUSY storm; the merge-backup site
  templates/handler.js:600-607 writes an UNKEYED = plaintext copy — replace with a keyed copy,
  blocking; DPAPI-loss drill; perf <10% on the owner's real DB; full app session incl.
  verifyAuditChain + /v1); 3 = default-on FRESH installs + downgrade tripwire (key present +
  plaintext sniff + no manifest = loud fail) + ceremony ack/nudge/regenerate. Audit archives
  (`audit_archive.js`) keyed as the FINAL slice; `src/database.js` is dead — delete. **C7: the
  dev/night-run rituals change IN THE SAME COMMIT as slice 2** (reset = delete db + wal + shm +
  .db-key + .db-recovery; harness copies via `db-crypto-tool export-plain` — RUN_AS_NODE cannot
  unwrap DPAPI). Scope honesty: filed PDFs/inbox/XMLs stay plaintext; BitLocker = the disk answer.

## Live state (VERIFY-FIRST items for the next session)

- **Live DB** back at `%APPDATA%\ScanFinder\docusnap.db` (the owner renamed it away to
  `ScanFinder 31.08.26` for an install test ~13:40, then back). The four arc switches were
  flipped by hand ~11:50; the reslice pair flip FAILED against the renamed dir — **mig 98 heals
  everything on any app start running `0ddd268`+**. VERIFY: `SELECT value FROM settings WHERE key
  IN ('reslice_witness_sweep','corrob_discount_invalid_witness')` — if 'false', the running app
  predates mig 98; a restart fixes it.
- **The owner's app** was running mid-afternoon (his exhibit screenshots); state now unknown.
- **Chris sandbox DOWN** (killed in the build-lock incident); rebuild via /christest when needed.
- **Session-tmp artifacts are MORTAL** (job tmp dies with the job): the realdoc gate copies +
  runs live durably in `TESTING/_measure/dark_arcs_20260831/`; Hard Set + scores on the Desktop.

## Traps refreshed today (full list also in CLAUDE.md)

- **Builds need EVERY electron closed** — better-sqlite3 EBUSY on the ABI rebuild.
- **NEVER taskkill by command-line-substring** — the query matches your own shell; it took the
  owner's live app down (recovered; logged).
- Start-Process stdout redirects proved flaky for detached runners — use Start-Transcript inside
  the runner instead.
- `git push` may be classifier-blocked — the owner runs `! git push origin feat/teach-side-overnight`.
- `process.env.APPDATA` came back empty in some electron-as-node children — hardcode the profile
  path in one-shot scripts.
- The dev-inspector trace's "@N%" badges are page-Y position, NOT confidence (renderer.js:10409).
- Stale-doc debt pattern: two "DARK until owner flip" comments were years-old lies (blind-geom
  fixed in `655f915`); trust code + oracle_log over prose.

## First actions for a new session

1. Read this file; `git log --oneline -20` to confirm HEAD ≥ `9575883`.
2. Ask the owner (or read the chat) WHICH design(s) to build; each build = its oracle_log entry's
   conditions are the spec, gates before any flip.
3. Verify the live-DB switch state (above) and whether the second-machine installer test surfaced
   anything.
4. The push: `655f915` + `9575883` + the wrap commit await the owner's push.
