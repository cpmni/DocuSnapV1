'use strict';
/*
 * test_issuer_ripple_contract.js — the correction-ripple "Apply 'X' to N & re-read" must actually
 * re-read (Chris round-11 card #1; gary→Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-21).
 *
 * THE BUG THIS EXISTS FOR. The ripple wrote the pins then re-read through the generic
 * runReprocessBatch, whose own confirm() dialogs early-return BEFORE the re-read. A dismissed dialog
 * (a scripted driver auto-dismisses window.confirm; a real user may Cancel the discard warning)
 * swallowed the whole re-read: pins written, offer removed (looks like success), nothing re-read →
 * "set nothing that stuck, reverted the one I'd fixed."
 *
 * The fix, and what this test pins (renderer wiring is pinned by parsing, per repo convention —
 * test_letterhead_note_contract.js / test_deskew_session.js):
 *   - runReprocessBatch(docs, scopeLabel, opts={}) — BOTH confirms guarded by !opts.preConfirmed, so
 *     the consented ripple path can never be swallowed by a dialog.
 *   - the finally refetch of the open doc guarded by !opts.preserveOpenDoc (the Oracle seam: don't
 *     wipe a source that carries other unsaved edits and wasn't re-read).
 *   - the ripple passes { preConfirmed:true, preserveOpenDoc }, pins [srcDocId, ...siblingIds],
 *     re-reads from a pool that INCLUDES deferredQueue, and includes the SOURCE in the re-read only
 *     when _sourceOnlySupplierDirty().
 *   - NARROWING: Reprocess-All and Reprocess-this-sender pass NO opts, so they KEEP their warnings
 *     (the scary all-queue confirm exists because of Chris's earlier "re-read 160 on one click").
 *
 * Run: node src/windows/review/test_issuer_ripple_contract.js
 */
const fs = require('fs');
const path = require('path');
const R = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const at = (needle, from = 0) => R.indexOf(needle, from);

// ── runReprocessBatch: the swallow-proofing ──────────────────────────────────────────────────
const rrbStart = at('async function runReprocessBatch');
const rrb = R.slice(rrbStart, at("document.getElementById('btn-reprocess-all').addEventListener", rrbStart));
check('runReprocessBatch takes an opts bag', /async function runReprocessBatch\(docs, scopeLabel, opts = \{\}\)/.test(rrb));
check('the "Re-read all N?" confirm is guarded by !opts.preConfirmed (ripple cannot be swallowed)',
      /!opts\.preConfirmed[\s\S]{0,120}Re-read all/.test(rrb));
check('the pending-edits discard confirm is ALSO guarded by !opts.preConfirmed',
      /!opts\.preConfirmed && hasPendingReviewEdits\(\) && !confirm\(REPROCESS_DISCARD_WARNING\)/.test(rrb));
check('the open-doc refetch in the finally is guarded by !opts.preserveOpenDoc (seam: preserve other edits)',
      /if \(currentDoc && !opts\.preserveOpenDoc\)/.test(rrb));
check('the queue/deferred refresh is NOT inside that guard (rippled siblings still repaint)',
      rrb.indexOf('getReviewQueue()') > rrb.indexOf('!opts.preserveOpenDoc'));

// ── the ripple apply handler: consent-carried, source-safe, deferred-covered ─────────────────
const ripStart = at('async function offerIssuerRipple');
const rip = R.slice(ripStart, at('LOGO SUGGESTION', ripStart));
check('the ripple pins the SOURCE too (idempotent) via [srcDocId, ...siblingIds]',
      /pinIds = \[srcDocId, \.\.\.siblingIds\]/.test(rip) && /applyIssuerRipple\(pinIds, name\)/.test(rip));
check('the re-read pool INCLUDES deferredQueue (deferred siblings were pinned but never re-read)',
      /pool = \[\.\.\.\(queue \|\| \[\]\), \.\.\.\(deferredQueue \|\| \[\]\)\]/.test(rip));
check('the SOURCE joins the re-read only when _sourceOnlySupplierDirty()',
      /rereadIds = _sourceOnlySupplierDirty\(\) \? pinIds : siblingIds/.test(rip));
check('the ripple re-read is pre-consented (no swallowable confirm)',
      /runReprocessBatch\(docs, [^,]+, \{ preConfirmed: true, preserveOpenDoc \}\)/.test(rip));
check('preserveOpenDoc is true unless the source is actually in this batch',
      /preserveOpenDoc = !docs\.some\(d => d\.id === srcDocId\)/.test(rip));

// ── the seam guard: only-supplier-dirty is strict ────────────────────────────────────────────
const sodStart = at('function _sourceOnlySupplierDirty');
const sod = R.slice(sodStart, at('\n}', sodStart) + 2);
check('_sourceOnlySupplierDirty exists', sodStart > 0);
check('...rejects any correction other than supplier_name', /corrKeys\.some\(k => k !== 'supplier_name'\)/.test(sod));
check('...rejects a staged ⊕ teach (pendingAnchors)', /pendingAnchors[\s\S]{0,80}return false/.test(sod));
check('...rejects a staged field rule (pendingFieldRules)', /pendingFieldRules[\s\S]{0,80}return false/.test(sod));
check('...rejects a manual type override', /selectedTypeSlug && detected && selectedTypeSlug !== detected/.test(sod));

// ── NARROWING: the generic callers keep their warnings (preConfirmed stays scoped) ───────────
check('Reprocess-All passes NO opts (still confirms — cannot be swallowed away)',
      /runReprocessBatch\(\[\.\.\.queue\], 'all in queue'\)/.test(R) && !/runReprocessBatch\(\[\.\.\.queue\], 'all in queue', /.test(R));
check('Reprocess-this-sender passes NO opts (still confirms)',
      /runReprocessBatch\(docs, sup\)/.test(R) && !/runReprocessBatch\(docs, sup, /.test(R));

// ── THE DOORWAY (Chris r12 #1): a TYPED issuer correction offers the ripple too ────────────────
// The "Use 'X'" branding button was the only trigger; the cold-start prefill note displaced the
// branding note, so typing the real name over "Cleaning" never offered "Apply to N & re-read".
check('the typed-issuer blur handler offers the ripple (same bar, same apply path)',
      /if \(key === 'supplier_name' && !bulkFiling && !_batchActive\) \{[\s\S]{0,700}offerIssuerRipple\(currentDoc\?\.id, typed, row\)/.test(R));
check('...only when the settled value DIFFERS from the read (a no-op edit offers nothing)',
      /typed && typed !== orig && typed !== row\.dataset\.rippleOffered/.test(R));
check('...once per distinct typed name (a blur/refocus loop cannot nag)',
      /row\.dataset\.rippleOffered = typed;/.test(R));
check('the "Use X" doorway is still there (two doors, one bar)',
      (R.match(/offerIssuerRipple\(/g) || []).length >= 3);   // definition + button + typed

console.log('\n' + (fails === 0 ? 'All issuer-ripple contract checks passed' : `${fails} FAILED`));
process.exit(fails ? 1 : 0);
