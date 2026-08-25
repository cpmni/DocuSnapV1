# Chris The Customer — Full App Review — 2026-08-25

## Round 1 (post-resume vet)

**Sandbox conditions:** fresh install (create-admin first-run), CDP 9223, mig 87, ~135 switches ON bar
straighten. THIS ROUND additionally armed `batch_audit_enabled=true` so Chris could vet the brand-new
"Quick check" grid (its backend landed 2026-08-24 `eef96bd`, the front-end resumed + committed this
session `c1d5c08`). Corpus = Demo Docs (Copperfield + Saltmarsh imported). Two DARK backend arcs
(`name_dominant_snap`, `branding_strip_reg_boilerplate`) stayed OFF (backend accuracy, can't fire on a
fresh untaught corpus, not Chris-visible).

**Sandbox login Chris created:** `chris` / `plumber2026` · recovery `2KEF-SMEQ-2MGU-BRRC`.

### Triage (owner authorised "fix problems then re-run Chris" for this overnight round)
| Card | Sev | Verdict | Action |
|---|---|---|---|
| 1 — Confirm & File accepts a present-but-invalid date → silent misfile to `Unknown-Year/Unknown-Month` | HIGH | REAL BUG (known class) | **FIXED** — gary+Oracle WRONG-LAYER: gate on `filing.normaliseDate` server-side (reviewService.confirm refusal + `_autoFileDoc` hold + batchAudit align + renderer pre-block) |
| 2 — Terms say "WORKING DRAFT… NOT YET IN FORCE" + `[SOLICITOR:]` notes | HIGH (trust) | Owner domain (legal) | QUEUED — owner finalises solicitor text |
| 3 — Quick-check re-file renames `Invoice.…` → `Document.…` | MOD-HIGH | REAL BUG (new code) | **FIXED** (`batchAuditService._resolveDtInfo` resolves slug from `document_type_id`) |
| 4 — Half a new supplier's invoices → "Sender not identified" (logo matched another co, text disagrees) | MOD | Detection arc | QUEUED — letterhead-name-over-abstain; needs census+Oracle, too risky overnight; one confirm teaches it |
| 5 — Quick-check Cards view shows dev codes (`anchor_inline`/`keyword`) | LOW-MOD | REAL (new code) | **FIXED** (`_baFieldMeta` drops the method token) |
| 6 — Queue row still says "Needs: Invoice Date" after the field was filled | LOW | Stale-refresh nicety | QUEUED — low, refresh-timing, Chris himself unsure it's real |
| 7 — Empty bin removes the PDF but leaves the `.metadata/*.xml` sidecar | LOW | REAL minor bug | **FIXED** (`_purgeOne` removes the sidecar) |
| Config note — the grid was ON but the activity strip (its entry point) was OFF | — | Flip coupling | QUEUED — flip the strip wherever the grid is on |

### Verdict
**Yes — would keep using it and pay.** Wanted Card 1 + Card 3 fixed before trusting it unsupervised
(both fixed this round); Card 2 (draft Terms) would make a customer hesitate at the shop door.

---

### Chris's report (VERBATIM — transcribed from the completion notification; the live transcript comes back empty per the standing trap)

**Sandbox login:** `chris` / `plumber2026` · recovery `2KEF-SMEQ-2MGU-BRRC`.
**Harness note:** the CDP driver auto-dismisses native `confirm()` dialogs; for File All / Apply corrections / Empty bin, Chris captured + judged the wording then accepted on the user's behalf so the actions genuinely ran. He turned ON `review_activity_strip` to reach the Quick-check button (config note below). All inside the sandbox.

#### Finding cards (ranked by harm)
- **Card 1 — Confirm & File accepts an invalid date and silently files to "Unknown" — HIGH.** Empty date correctly greyed Confirm; a present-but-unreadable date ("1/ 2026" → "Not a valid date") left Confirm ENABLED, filed with no warning to `…/Copperfield-Electrical/Unknown-Year/Unknown-Month/Invoice.INV-29273.pdf`. "I would never know it misfiled." Proposed: treat "Not a valid date" like empty — block/warn.
- **Card 2 — The Terms say "WORKING DRAFT… NOT YET IN FORCE" with "[SOLICITOR:]" notes — HIGH (trust).** Agreeing to a document that says it isn't finished. Reported as a QUESTION; content undermined confidence. Owner/legal domain.
- **Card 3 — Correcting a value in Quick check re-files "Document.…" instead of "Invoice.…" — MOD-HIGH.** Success msg "✓ Re-filed as Document.23-11-2026.INV-29597-QCTEST.pdf"; on disk `Document.…pdf` while the other 17 are `Invoice.…`. Filing got less accurate as a side-effect of fixing a number.
- **Card 4 — Half of a new supplier's invoices land in "Sender not identified" — MOD.** "Saltmarsh Seafoods" printed large on every page, yet 9/20 came back no-sender because the badge matched a different company ("logo matched another company but the page text doesn't agree"). Proposed: prefer the large printed letterhead name over abstaining.
- **Card 5 — Quick check Cards view shows developer codes ("94% · anchor_inline", "95% · keyword") — LOW-MOD.** Table view sensibly shows just the %; Cards added the internal labels.
- **Card 6 — The queue row still says "Needs: Invoice Date" after it was filled — LOW.** Stale until confirm/reprocess.
- **Card 7 — Empty bin removes the PDF but leaves a stray `.metadata/*.xml` — LOW.** Warning itself truthful.

#### Warnings truth-table
| Button | Warned | Actually | Truthful? |
|---|---|---|---|
| Delete (single) | "recycle bin… restore later" | binned, filed copy kept, restorable | ✅ |
| Restore all | "back to review queue or filed folder" | restored to filed, no duplicate | ✅ |
| Empty bin | "permanently delete… including PDFs… originals not touched" | filed PDF removed, 20 originals untouched; XML sidecar left | ✅ (minor leftover) |
| File All Ready | "File 18 (of 19)… 1 flagged stays… as if you confirmed it" | filed 18, left the 1 | ✅ |
| Split PDF | "only one page — nothing to split" | correct | ✅ |
| Reprocess | (no warning — non-destructive) | re-read, issuer still Not found | ✅ |
| **Confirm & File (invalid date)** | **(no warning)** | **filed to Unknown-Year/Unknown-Month** | ❌ **Card 1** |

**Config note:** the Quick-check *grid* was enabled but the *activity strip* carrying its button was OFF (`review_activity_strip` unset) — as shipped in this config a customer would never see the entry point. Flip the strip on wherever the grid is on.

#### What worked / friction / verdict
- **Worked:** honest automation everywhere (File All "as if you confirmed it yourself"; "your original scans are never deleted"; issuer-confirm note; Empty-bin reassurance); the Quick-check grid concept + execution; instant search retrieval.
- **Biggest friction:** the invalid-date silent misfile (Card 1) breaking the app's otherwise-honest "shows its work" promise.
- **Two-week verdict:** **Yes — would keep using it and pay.** Wanted Card 1 + Card 3 fixed before trusting it unsupervised; the draft Terms (Card 2) would make him hesitate at the shop door.
- **Humility:** one simulated non-technical user, one pass; some issues (garbled taught date, needing to enable the strip) came from how he drove the app; impressions for the owner to vet.


---

## Round 2 — focused re-verify (same sandbox userData relaunched on the fixed code)

All four fixes confirmed live; no regressions. Verdict: **yes, with more confidence than last round.**

| Card | Verdict | What Chris saw |
|---|---|---|
| 1 — invalid date silent misfile | **FIXED** | `1/ 2026` → field "Not a valid date", plain message about an unknown date, Confirm & File **disabled**. `15/12/2025` files fine. OCR-spaced `15 / 12 / 2025` filed correctly to `Saltmarsh-Seafoods/2025/December/Invoice.15-12-2025.INV-79528.pdf`. |
| 3 — Quick-check keeps the type in the name | **FIXED** | Edited a value, Apply → re-filed `Invoice.07-02-2026.INV-25557-QC.pdf` (kept "Invoice."). |
| 5 — no dev codes on Cards | **FIXED** | Cards show only "100%" / "Invoice Date 98%" etc. — no anchor_inline/keyword. |
| 7 — no orphan metadata on Empty bin | **FIXED** | PDF and its `.metadata` XML both removed; only an empty `.metadata` folder remains (harmless). |

Historical residue confirming the bugs were real (from round 1, pre-fix, still on disk):
`Copperfield-Electrical/Unknown-Year/Unknown-Month/Invoice.INV-29273.pdf` and `.../November/Document.23-11-2026.INV-29597-QCTEST.pdf`.

**New (low harm) — Card A:** OCR-spaced `15 / 12 / 2025` showed a red "Not a valid date" field note while
the Confirm button stayed active and the doc filed correctly — a mixed signal (no harm). QUESTION-class.
→ FIXED this session (`97d3527`): the on-blur date note now accepts whatever `_parseDrawnDate` accepts
(preclean), so it agrees with the Confirm button and the folder builder. Only relaxes → no new false warning.

Regression sweep: import+review, File All Ready (honest zero-filed receipt), search, delete→restore — all pass.

---

## Round 3 — Card A single-fix verify (sandbox relaunched on `97d3527`)

**Card A → FIXED.** Spaced `15 / 12 / 2025`: no red note, "High · 98%" tag, Confirm active — note and button
agree. Broken `1/ 2026`: red "Not a valid date" + the plain helper "The Invoice Date can't be read as a real
date, so this document would be filed under an unknown date. Please correct it before filing." + Confirm
**disabled**. Sanity pass (normal review+file ticked 19→18; search found the just-filed doc). No regressions.

**Trivial cosmetic aside (queued, not fixed):** on a broken date the green "High · 98%" read-confidence pill
still sits beside the red "not valid" note. Chris confirmed it did NOT mislead (button disabled + helper
clear). It's read-confidence (the OCR was sure what it read) vs typed-value-validity — a genuine tension, not
a bug. Owner may tidy the pairing if desired; low value.

## Session outcome
4 real bugs (Cards 1/3/5/7) + 1 cosmetic wrinkle (Card A) — **all fixed and Chris-verified across 3 rounds,
zero regressions.** Commits `200e68d` (Cards 1/3/5/7) + `97d3527` (Card A). **Owner vet queue (not built):**
Card 2 (draft Terms — legal), Card 4 (letterhead-name-over-abstain detection arc — census+Oracle), Card 6
(stale queue-row refresh), the grid↔activity-strip flip coupling, and the green-pill/red-note cosmetic pairing.
