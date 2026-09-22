# HANDOVER — 2026-09-03 NIGHT (autonomous)

Branch `feat/teach-side-overnight`. **HEAD = `5398b05`.** Owner went to bed on AUTO with explicit
instructions: design the Gate-C reference-note fix (lighter checkpoint), consult Oracle + agents, build,
have Chris audit, **make it revertible in the morning**. All done. **Everything is DARK-by-default and
behind kill switches; nothing pushed** (all local, for easy revert).

## What shipped tonight (5 local commits on top of the pushed `13fa3a9`)
| commit | what | live? |
|---|---|---|
| `238e13a` | feat FORMAT_VARIANCE_RELAX_REF_INLINE — box-drift disagreement flag suppressed on exact confirmed literal (DARK, mig 109) | — |
| `cd1121f` | chore TEST force-ON `_inline` (mig 110) | setting ON |
| `205143a` | fix(watch) db_id stamped before mirror — split rows open the right doc + show Filed | code (no switch) |
| `661cd2a` | feat FILING_SANITY_REF_CORROB_SOFTEN — Gate-C truthful soft note (DARK, mig 111) | — |
| `5398b05` | chore TEST force-ON soften (mig 112) | setting ON |

Earlier today (already PUSHED): `dd4c855`+`13fa3a9` = FORMAT_VARIANCE_RELAX_REF parent (mig 107/108).

## The three reference arcs — one family, three choke points
The owner kept hitting "why is this reference flagged when it's clearly right?" on Print Tracker printer
serials. Root: OCR ambiguity on the serials + a full-page pass that disagrees with a good crop read.
Three DIFFERENT code paths were minting a flag on the SAME class:
1. **Shape-variance** (`_gate_value`) → **FORMAT_VARIANCE_RELAX_REF** (mig 107/108, pushed). Suppress the
   "format differs" shape-warn on an exact confirmed literal.
2. **Box-drift disagreement** (`_pick_fuller_code`) → **FORMAT_VARIANCE_RELAX_REF_INLINE** (mig 109/110).
   doc121: taught box read GARBAGE `10RARNNNAD`@44, inline recovered `1984800049`@96, flagged the
   disagreement. Suppress on exact confirmed literal + Oracle R2 rigid-credibility guard (`<70`).
3. **Page-witness absence** (`_flag_filing_value_sanity` Gate C) → **FILING_SANITY_REF_CORROB_SOFTEN**
   (mig 111/112). doc196: crop+mapping read `752923124N3M2`, full-page pass slipped to `782923124N3M2`
   (5↔8 unbacked); Gate C said "doesn't appear on this page as written" — FALSE + scary. Owner chose the
   LIGHTER checkpoint: **rewrite the note to a truthful one, keep the doc in review** (never auto-file).

## Tonight's new build — FILING_SANITY_REF_CORROB_SOFTEN (the owner's ask)
reggie (predicate) + gary (integration) → **Oracle SIGN-OFF-W/COND (C1 ship-blocking)**. Oracle's C1:
plain note-suppression would auto-file the FILENAME token over the sole whole-page reader (crop+mapping on
a boxed ref are the SAME LOCATED BOX — the documented "two preps agreed on the wrong P1" 5:1 same-pixel
class; the mirror true=`782` minority / crop+mapping common-mode `8→5` to confirmed-literal `752` is
undistinguishable from doc196). **Owner's lighter-checkpoint choice satisfies C1 by construction:** the soft
note is STILL a validation_note → `trust.isAutoFileEligible` unchanged → doc stays REVIEW-BOUND. Auto-file
behaviour is byte-identical; the mirror is HELD for a human, never silently filed.

The 4-clause predicate (`engine._ref_corrob_soften`, all required): (1) ≥2 independent page families agree
(record derived on-demand via `_build_corroboration_emit` off `self._field_candidates` — final for the ref
at Gate-C time); (2) exact confirmed in-scope literal; (3) the sole page dissent is a SAME-LENGTH one-glyph
slip (new `_same_length_one_glyph`, UNBACKED) sourced from the corroboration dissent; (4) NO clip container
(preserves the `VXS986⊂VXS98624` catch). New note `_FILING_SANITY_SOFTEN_NOTE` with a DISTINCT mark (the 3
absent-note consumers never match it). Env bridge `handler.js`; mig 111 seed OFF; mig 112 TEST force-ON.
Pin `test_filing_sanity_ref_corrob_soften.py` **14/14** (RED-first; heal / MIRROR held / CLIP scary /
never-confirmed scary / uncorroborated scary / Gate A untouched / fail-closed / source-order). Filing
page-match v2 regression **25/25**. Oracle log appended.

## ⚠ REVERT LEDGER (owner, morning) — everything tonight is trivially undoable
Nothing is pushed, so nothing left this machine. Pick the level:

**A. Quietest — behave exactly like before tonight, keep all code (flip the two NEW arcs OFF).** In the app:
Settings → (SFDEV) or just run this against the live DB while the app is closed:
```
UPDATE settings SET value='false' WHERE key IN ('format_variance_relax_ref_inline','filing_sanity_ref_corrob_soften');
```
(Leave `format_variance_relax_ref` — the parent — as you've been running it all day, or add it to the list
to quiet that too.) Reprocess a doc → byte-identical to pre-tonight. The watch db_id fix stays (it's a pure
bugfix, no switch — recommended to keep).

**B. Remove tonight's code entirely (keep nothing).** `git reset --hard 13fa3a9` — drops all 5 local commits.
If you want to KEEP the watch fix: `git reset --hard 13fa3a9 && git cherry-pick 205143a`.

**C. Remove ONE arc.** `git revert <commit>` for the pair, e.g. the soften: `git revert 5398b05 661cd2a`.
The force-ON migrations (110/112) already ran, so ALSO flip its setting false (option A) — a git revert of
the migration block doesn't un-apply an already-stamped migration.

## Verify in the morning
- Reprocess **doc196** (Print Tracker, ref `752923124N3M2`): the note should now read *"This reference reads
  as '752923124N3M2' where it is labelled, but the full-page text reads it as '782923124N3M2' — please
  confirm the reference before filing."* (truthful, no "doesn't appear"), and it stays in review.
- Reprocess **doc121** (`1984800049`): heals clean (INLINE arc).
- Machine-only serials (`RFC9508317` etc., 0 human confirms) still flag — that's your keep-conservative
  choice; confirm one manually and future re-imports heal.
- **Watch:** drop a bundled PDF in the watch folder → split rows open the right doc + show Filed.

## Census / gate STILL OWED before any customer build (all three arcs)
- Revert the TEST force-ON migs (108/110/112) or gate them.
- FORMAT_VARIANCE_RELAX_REF / _INLINE: WARM-DB census — each clean-commit == that DOC's own prior-confirmed
  value (not "any literal" — Oracle's circularity trap), realdoc M=0.
- SOFTEN: realdoc M=0 (auto-file unchanged by construction) + WARM-DB census scored against INDEPENDENT GT,
  with `learning_exclude_machine_confirms`+`autofile_gate_unify` asserted ON.

## Chris audit — DONE (report `docs/CHRIS_FULL_APP_REVIEW_2026-09-03.md`; sandbox left up on port 9223)
Verdict: **would keep using it.** Warnings truth-table ALL TRUE (best in the app). **The watch fix is
CONFIRMED working** — he clicked four result rows (incl. the blank-company row + the bundle) and each opened
ITS OWN document, never the first. The new reference note passed his read-aloud test — "clearly less
alarming and more actionable than 'doesn't appear on this page as written' — tells me exactly what to do."

**Triage of his 6 findings (IMPLEMENT NOTHING without the owner's go):**
1. **[NEW, real, HIGH] Import results row still says "Confirm to file →" after a MANUAL confirm+file** — the
   doc is genuinely filed on disk, but the main-window import row never flips to "Filed", and clicking it
   re-opens Review with a green "Confirm & File" (possible DUPLICATE trap; Chris did NOT press it). This is a
   DIFFERENT path from tonight's watch fix (which handled the row→doc MAPPING + the AUTO-file flip via
   `doc-auto-filed`): `markRowFiled` fires on auto-file only, not on a manual `reviewService.confirm`. Fix
   direction: emit a `doc-filed`/reuse `doc-auto-filed` on a manual confirm too, so the import row flips.
   **Owner vet before building.**
2. **[KNOWN] Watch bundle imported whole (pages 2-3 hidden)** — this is `watch_separate_enabled` DARK (soak
   gate already set up `696b4bf`, owner runs it). Chris's addition: a one-line "3 pages — split?" nudge on the
   row. Folds into that arc.
3. **[real, pre-existing] "3 fields flagged by a formatting check" with no per-field mark** — summary count
   not tied to a field. Vet.
4. **[cold-start, low] sender/customer note on EVERY doc** — warning fatigue on a cold batch; Chris watched it
   fade after one confirm. Only worth narrowing if cheap.
5. **[tonight's copy — 1-word nit] the new soft note** — WIN, but "full-page text" trips him; he'd say
   "elsewhere on the page it looks like 'Y'". It's the copy in tonight's DARK `FILING_SANITY_REF_CORROB_SOFTEN`
   (`engine._FILING_SANITY_SOFTEN_NOTE`) — a trivial reword IF you want it. Left as-is per "implement nothing".
6. **[taste] bare % on chips** — prefer a word over "31%". Minor.

Sandbox instance left running for you to poke (port 9223); the next `/christest` rebuilds it.

## Pre-existing (not mine): `test_settings_wiring.js` fails ONE check — missing `stamp-*`/`dbenc-*` element
ids the settings renderer references (from the stamping / DB-encryption arcs). Unrelated to tonight; noted.
