# Supplier identity — text-first redesign (2026-07-19 overnight)

**Status: DESIGNED, AWAITING OWNER SIGN-OFF (then Oracle vet before build).**
Origin: the owner's Larkspur incident + verbatim question: "I am questioning whether the
'this logo is like' selection on 1st import is a good idea." Panel: forensics (this session) →
Barry (product) → gary (engineering). Nothing built beyond the test suite.

## 1. The incident, diagnosed on the live DB
20 delivery dockets from a NEVER-SEEN supplier (Larkspur Interiors). The logo layer assigned
4 to Ridgeway (logo@69, branding-guard-held) and 1 via a Copperfield template (logo@89 =
hamming ~2 from a Copperfield hash). Correcting one doc planted ONE Larkspur fingerprint —
against Ridgeway's 3 and Copperfield's 6, nearest-neighbour still favoured the wrong pools, so
the siblings never re-matched. The branding TEXT identified 'Larkspur Interiors' correctly on
every misfiled doc — but it only acts as a late flag, never as the identity source.

## 2. Measured (stress_test/logo_identity_suite.py — permanent, read-only, GREEN e570c7a)
- 64-bit phash: cross-supplier MIN distance **2** vs same-supplier min 6; medians identical
  (18 vs 20). Zero separating power on scans; both accept seams take ≤12.
- `logo_fingerprints.detail_hash`: **0% populated** — the Slice-D 256-bit resolver never
  engages at the fingerprint layer (enrolment plants detail into templates only).
- Keyword branding fingerprints: worst cross-supplier overlap **0.22** vs the 0.80 bar —
  clean separation on the same install.
- The `match_count` confidence bonus makes an established WRONG pool score higher
  (anti-healing — why one correction can't outweigh the wrong cluster).
- 6 [PIN-BROKEN] checks pin this reality; a fix flips them consciously, never silently.

## 3. Product direction (Barry)
**Text-first, logo corroborates, abstain-by-default.** The wrong first-contact guess buys the
user NOTHING (a new supplier can't auto-file anyway) and costs poisoned learning + template
fragmentation + automation-bias bait (a plausible wrong prefill invites rubber-stamping).
"The letterhead reads 'Larkspur Interiors'" is explainable; "hamming distance 2" is not.
Identity ladder: (1) text-match to a known sender → assign (logo raises/notes, never
overrides); (2) clean unknown name → first-class **"New sender"** state, proposed not
asserted; (3) text-poor + near logo → SUGGEST only, review-bound, no learning; (4) nothing →
plain review. A logo match alone never crosses the assign line and never plants learning.
Healing: the redesign IS the migration (poisoned pools become harmless); quarantine-not-delete
check-up later; self-heal on confirm. Correction must RIPPLE (one fix reaches the batch)
via text-similarity + the pin rail — never via the logo layer. Roadmap framing: "ScanFinder
reads the letterhead the way a person does." Recommended order: gate → ripple → new-sender
state → quarantine → batch-cluster triage (the L3 differentiator).

## 4. Engineering design (gary — full seam ledger in his 2026-07-19 report, key facts here)
FACTS: the engine call site (engine.py:2358-2377) has ocr_text + templates + the match in
scope; `_flag_branding_conflict` (:1271) already builds the per-supplier word banks (refactor
out `_branding_banks`/`_branding_own_ratio` — pure); auto-file plants no learning directly but
flips docs confirmed (the poison path is auto-file → confirmed corpus; the note is the
complete block); **the renderer twin `attemptLogoMatch` (review/renderer.js:4375) is NOT
display-only** — it auto-fills the empty supplier from the same broken metric and writes
`corrections['supplier_name']`, then `saveLogoOnConfirm` plants the phash under it; Stage-0
`identify_template` accepts on logo dist ≤6 ALONE (keyword overlap is only a tie-break);
ripple rails exist (supplier_pin + --known-supplier reprocess, review-bound, no plants);
`documents.keyword_fingerprint` + shared `branding_fingerprint.js` overlap module exist.

### SLICE 1 — text-agreement gate (kill `LOGO_TEXT_GATE`, default ON; OFF byte-identical)
At the ENGINE call site, three-way on the logo match:
1. **CORROBORATED** (bank exists, own_ratio > 0.25) → accept exactly as today (byte-identical).
2. **UNJUDGEABLE** (no ≥3-word bank / text-poor page) → keep value, demote to suggest-only:
   conf ≤ 69 + note + `text_agree:false` marker; method stays 'logo' (preserves the two traced
   method-string consumers). Note = the auto-file lock.
3. **POSITIVE DISAGREEMENT** (bank exists, own_ratio ≤ 0.25) → ABSTAIN (no supplier from the
   logo); falls through to template-identity fill / keyword / empty→review; the late branding
   flag stays as the independent backstop.
- **Slice 1c (renderer)**: `attemptLogoMatch` auto-fill → the existing "Use '<name>'" click
  affordance (closes the rubber-stamp back door). `learning.findLogoMatch` has no live caller
  (verify A2).
- **Slice 1d (follow-up, own corpus gate — NOT bundled)**: Stage-0 logo-only template accept
  gains a keyword-overlap floor. Residual until then: a wrong Stage-0 match arrives flagged at
  review, never silently filed.
- Go-forward only; no purge migration; poisoned pools become harmless.
- PINNED TRADE-OFF: a template-less logo supplier at hamming 0 with clean text NEVER asserts
  above 69/without a note (a future dev must not restore logo-alone assertion).

### SLICE 2 — correction ripple (kill `SUPPLIER_RIPPLE`, additive-only; no corpus needed)
On `resolve-issuer` success only (explicit identity action; confirm-path ripple = Slice 2b,
deferred like B-safety): pure `database/modules/supplierSiblings.js` findSiblings — candidates
= needs_review/deferred, unpinned, ≠ pinned value; score `symmetricDistinctiveOverlap ≥ 0.80`
on stored `keyword_fingerprint` (fallback distinctiveTokens(ocr_text); both null → []); cap 25.
IPCs `find-issuer-siblings` (read-only) + `apply-issuer-ripple` (per-doc supplier_pin + audit →
existing batch-reprocess door, workflow-lock skips ride free). UI: one non-blocking bar after
the Use-button — "N more unfiled documents look like the same sender — Apply & re-read / Not
now." A wrong ripple costs one review-bound pin, never a filed value.

### Verification gates
Slice 1: baseline BEFORE code; unit battery `test_logo_text_gate.py` (corroborated
byte-identical · disagreement abstains · unjudgeable ≤69+note · OFF reproduces the incident ·
bank refactor leaves test_branding_conflict green · the pinned trade-off); suite §6 gate
checks (the §3 PIN-BROKEN pins DO NOT flip — the pure core is untouched); corpus A/B M=0 +
M_type unchanged + zero supplier/ref/date drop + COUNT the new review-hold population (the
honest cost line — mitigation is enrolment self-healing, not loosening). Slice 2: JS unit
battery (overlap bar both sides, exclusions, cap, fail-safe, no-plant pin).

### Open items for the owner (morning decisions)
D1. Sign off the direction (text-first / abstain-by-default) → then Oracle vet → build order:
    baseline → 1a refactor → 1b gate+A/B readout → 1c renderer → 2 ripple.
D2. Barry slices 3-5 (New-sender state, quarantine check-up, batch-cluster triage): queue now
    or after 1+2 prove out?
D3. Slice-D detail-hash enrolment fix (the inert 256-bit resolver): worth doing at all under
    text-first, or retire the detail path? (Barry: don't bank on a better hash; 07-17 said
    even 256-bit fails on degraded scans.)
D4. The 5 misfiled Larkspur docs on the live install: fix by hand now (Use-button + reprocess
    per doc) or wait for the ripple slice and use them as its live test?
