# PLAN — Review over the search client (client UI, core does the work) — 2026-09-15

A fully-featured Review in the detached SEARCH CLIENT, where the CORE does all OCR / extraction / filing /
learning and the client is a thin UI + relay. A LICENSED, core-dependent add-on: it rides the EXISTING
floating search seat (no new flag), gated by `detached_client_licensed` + writer role, exactly as `/v1`
confirm/defer already are. No core = no review, by design.

**Status: SCOPE VETTED.** barry (product scope) + Oracle (SIGN-OFF-WITH-CONDITIONS) — 2026-09-15. This doc
is the staged build plan; each slice still takes its named advisor + an Oracle pass + the verification gate
before it lands. Nothing built yet.

The model is the one already proven TWICE: a SHARED UI module driven by an INJECTED transport (core IPC vs
`/v1`), a generated client copy + a no-direct-IPC/staleness pin (`scripts/sync-client-search.js`), so core
and client Review are identical BY CONSTRUCTION, not by discipline. This IS the owner's "behaves identically
to the core" requirement.

## Why v1 is cheap: the rails already exist (Oracle-traced in src/modules/api/handler.js)
- READ: `/v1/review/queue|deferred|counts` (isWriter, D2 viewer-scoped, each row carries `presence.viewers`).
- PREVIEW: `/v1/documents/:id` (+learning), `/page/:index`, `/page-info`, `/outline`, `/page-count`, `/find`,
  `/spreadsheet`, `/thumbnail` — all access-gated, paths resolved server-side (the client Search pop-out uses these).
- WRITE: `/v1/documents/:id/confirm` (race-safe `reviewService.confirm`, licence+workflow gated, values in body,
  `ALREADY_FILED`→409), `/defer`, `/undefer`.
- DRAW-A-BOX RE-READ (built for Teach): `POST /v1/documents/:id/ocr-region-boxes` (crop upload → {text,box,words,lines}),
  `/ocr-page-words`, `/page-deskew` (returns the same-dims straightened frame so coords still map). In-flight
  capped (OCR_MAX_INFLIGHT=3 / PAGEWORDS=2), audited, client-pixels-only (no path leak, no learning write).
- PRESENCE: `/v1/review/:id/viewing` heartbeat + `/release`. `/v1/doc-types` = field defs for the type dropdown.
- GENUINELY MISSING (both simple READS): a `/v1` validation-patterns GET, and per-field "show where it reads" boxes.

## The v1 boundary (barry 80/20, Oracle-confirmed)
**Must-have (this IS remote review):** queue list (flags/colour/counts + "being reviewed by X" chip) · zoom/pan
preview (reuse the client's Search preview) · field editor (value + type dropdown + required-field highlight,
current reads shown) · draw-a-box re-read · confirm/defer/undefer · presence heartbeat + graceful `ALREADY_FILED`.
**Should-have (fast follow):** on-blur validation (needs the `/v1` validation-patterns GET) · "show where it
reads" overlay (needs per-field boxes over `/v1`) · straighten/deskew.
**Stay CORE-ONLY (deliberate — protects the trust/control story):** reprocess-document (heavy) · Learning Repair /
Learning History (admin poisoning tool) · settings/output/licensing · Template Wizard (⚓) — but a "Teach this
document" CTA deep-links into the EXISTING client Teach wizard. Slip-fixer / Quick-check grid deferred indefinitely.
Delete: the `/v1` soft-delete/purge endpoints already exist; the Review UI simply omits a delete affordance.

## Corrections carried from the vet (do not repeat the stale framing)
- **FIDELITY (the marquee correction):** the desktop draw-a-box is ITSELF a low-DPI preview crop (108 DPI, render
  scale 1.5). There is NO full-pipeline-DPI working_path re-read on the desktop to fall short of. So the gate is
  crop-scale PARITY, not "coords full-DPI": crop the remote box from the existing `/v1 /page` render (default
  scale 3 = 216 DPI) → the remote read is EQUAL-OR-BETTER than the desktop, at zero new server cost. Do NOT build
  a client-only full-DPI working_path re-read (WRONG-LAYER; if ever wanted it's a shared previewService/region
  upgrade for BOTH transports).
- **Delete is already over `/v1`** (soft-delete/restore writer + purge/purge-all admin) — not a boundary you keep,
  just a UI affordance you omit.
- **`project_client_review_multiuser.md` is STALE:** it claims a client Review UI was DONE (no `client/renderer/review/`
  exists on this branch) and lists a stale-queue silent-refile gap that is now CLOSED (`reviewService.js:196`
  requires explicit `allowRefile===true`; the `/v1` confirm omits it → a stale confirm gets a clean `ALREADY_FILED`).
  Trust the code, not that note (being corrected alongside this plan).

## Slices (each: named advisor → Oracle → the gate; DARK/feature-gated; core byte-identical where stated)

### S0 — the focused shared `review-ui` module + transport seam  ⭐ the load-bearing carve
Extract a FOCUSED review subset (queue + preview + field editor + confirm/defer + correction-read) into
`src/windows/shared/review-ui/`, driven by an injected `window.ReviewTransport` (desktop IPC / client `/v1`).
**Oracle cond 6 (the effort risk):** `src/windows/review/renderer.js` is ~9,400 lines entangled with desktop-only
teach(⊕)/template-wizard(⚓)/learning-history/slip-fixer/deskew-all/split/logo — do NOT extract byte-identically.
Carve a NEW focused core that the DESKTOP also adopts; leave teach/template/learning in the desktop renderer.
Generated client copy + no-direct-IPC + staleness pin (mirror `scripts/sync-client-search.js`).
Advisor: eric. Gate: desktop Review pins stay green + a desktop behaviour/DOM diff unchanged after the carve
(proves the core stayed identical) + the no-direct-IPC/staleness pin.

### S1 — read-only review in the client (shippable + valuable alone)
Client Review tab: queue (flags/colour/counts + presence "being reviewed by" chip) + preview + field VIEW +
presence heartbeat/release. Zero write risk — a remote person can finally SEE the backlog. All endpoints exist.
Advisor: eric. Gate: entitlement pin (readonly/no-writer → 403 on every Review route; unlicensed → 402 on the
feature route; rides search+isWriter, NO new flag).

### S2 — the write loop + the held-gate acks + the ripple surfacing (the main prize)
Field editor + confirm/defer/undefer. **Oracle cond 3 (walled-off reviewer):** implement the acknowledge
round-trips for every held-gate refusal — TYPE_SPLIT / ISSUER_NEAR_MATCH / PREFIX_OUTLIER / INVALID_DATE (→field),
each with the escape the desktop has, OR route a blocked doc back to a desktop reviewer with the reason; also ship
the trivial `/v1` validation-patterns GET so on-blur validation matches the desktop. **Oracle cond 4 (silent
ripple):** a remote confirm fires class-fix / issuer-sibling-fill / position-nudge / buyer-convention on the CORE
(their undo/notice live on the desktop strip). Return `classFix/issuerFill/convention` in the `/v1` confirm DTO +
a client notice ("also updated N related documents"); DECIDE whether those ON-by-default propagations should fire
at all from a remote confirm whose undo is core-only. Graceful `ALREADY_FILED` auto-advance (never a scary dialog).
Advisors: eric (transport) + reggie (validation parity). Gate: confirm-gate conformance (each held-gate code has a
`/v1` test proving it refuses the bad value AND the ack passes the legitimate one — the test MUST drive the ack) +
the race pin (two concurrent `/v1` confirms, `/v1` vs desktop, vs auto-file → exactly one files, loser
`ALREADY_FILED`; a stale-queue confirm on a filed doc → `ALREADY_FILED`, never a silent refile).

### S3 — draw-a-box re-read (the "it's the full tool" moment)  ⚠ after cond 1
On the existing `ocr-region-boxes`. **Oracle cond 1 (crop-scale floor):** crop from a render at scale ≥ desktop's
1.5 — use `/v1 /page` scale 3 (216 DPI) → equal-or-better than the desktop. **Oracle cond 2:** reuse the teach
deskew-frame path (`/v1 page-deskew`) for the box coordinate frame on a skewed page — NO new coordinate route.
**Oracle cond 5:** handle the OCR 429 (cap overflow) with backoff + an honest "server busy, retry" — never a silent
blank read the reviewer then confirms. Never auto-commit a draw-a-box read; it populates the editable field only
(preserve the human-over-the-read checkpoint). **Slice-order (cond 7): S3 must not ship before the crop-scale floor.**
Advisors: oscar/007 (crop-parity fidelity) + eric. Gate: read-agreement parity harness — a corpus of
confusable-glyph / tight-code crops, `/v1 ocr-region-boxes` read == desktop ⊕ read for every crop at equal crop
scale (M = transport read-divergence, target M=0).

### S4 — fidelity + trust polish (fast-follow / differentiator)
`/v1` validation-patterns GET (if not already shipped in S2) · "show where it reads" overlay (needs per-field boxes
over `/v1`) · deskew for a skewed scan. Advisors: reggie + 007. Gate: parity of the overlay boxes vs the desktop.

### Later (only if asked) — barry's L4 bets
A TEAM DOCUMENT INBOX (multiple reviewers clearing one queue live, soft presence-claim + auto-advance) + a
tablet-friendly "approve-on-the-go" layout. Read `project_client_review_multiuser.md` before any multi-reviewer work.

## The verification gate (before the feature flips on for customers)
- Read-agreement parity harness (S3) — M=0 transport read-divergence at equal crop scale.
- Confirm-gate conformance (S2) — every held-gate refuses the bad value AND the ack passes the good one.
- Race pin — exactly one files across `/v1`×`/v1`, `/v1`×desktop, `/v1`×auto-file; stale-queue confirm →
  `ALREADY_FILED`, never a silent refile (keeps the closed gap closed).
- Desktop Review regression — existing review pins green + a desktop behaviour/DOM diff unchanged after S0.
- Entitlement pin — Review rides search seat + writer role; readonly→403, unlicensed→402; no new flag.

## Seams to remember (Oracle)
- The propagation side-effects of a HUMAN `/v1` confirm are real + fire on the CORE; their undo is desktop-only
  today (S2 cond 4). A remote reviewer must at least SEE the ripple.
- Re-file over `/v1` is impossible by design (`allowRefile` omitted) — a remote reviewer edits QUEUE items only,
  not already-FILED docs (editing a filed doc stays desktop-only). Document, don't "fix".
- The draw-a-box OCRs on the CORE on client request — the in-flight cap is the DoS guard; the client must honour 429.

## Build order
S0 (focused carve) → S1 (read-only) → **S2 (write loop + acks + ripple)** → S3 (draw-a-box, after the crop floor)
→ S4 (fidelity polish) → L4 (team inbox, only if asked). Each slice: DARK/feature-gated, byte-identical desktop
where stated, its own pins, its named advisor + Oracle, `npm run test:pins` green, and the relevant gate above.
Chris (sandboxed) after S2. Reports: barry scope + Oracle vet, 2026-09-15 (this session).
