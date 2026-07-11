'use strict';

// "Fix likely slips" proposer — extracted from review/renderer.js (2026-07-11) so the decision
// function is pure and testable, plus the ORIENTATION VETO added after the live inversion
// incident of 2026-07-11: on (Bramble & Finch, sales_order, sales_order_number) the in-scope
// majority was itself the poisoned form (docs mis-confirmed with a ZERO, "S0-…"), so the old
// majority-ward proposer renamed the two LEGITIMATE values INTO the poison (SO-66820→S0-66820,
// SO-27481→S0-27481). "Majority = truth" fails exactly when the majority is poisoned — which is
// the scenario the tool exists for. The veto orients symmetric letter↔digit confusion pairs
// (0↔O, 1↔I, 5↔S, …) by the CANDIDATE VALUE'S OWN LOCAL STRUCTURE — the one record in-scope
// poisoning cannot rewrite — and suppresses a class-crossing proposal whose target class the
// neighbourhood does not support. Suppress-only: the output is a strict SUBSET of the old
// proposer's output; the tool may propose nothing, it must never invert.
//
// THE VETO LIVES ONLY IN THIS PROPOSER. The manual ✎ rename path (applyLhRename →
// learning.renameFieldValue) MUST keep accepting class-crossing renames — the incident's own
// UNDO was five 0→O crossings toward the in-scope minority. Do not "harden" the veto into
// renameFieldValue; that would make the next inversion un-undoable (Oracle, 2026-07-11; pinned
// in database/modules/test_field_value_history.js).
//
// PURE functions (no DOM / no closure state). Exposed as window.SlipFix for the classic
// (non-module) window scripts, which load this before their renderer.js. The Python engine's
// confusion maps (extraction/ocr_corrector.py) mirror _OCR_PAIRS — keep them in sync.
// Guarded by src/windows/shared/test_slip_fix.js; offline old-vs-new regression twin:
// stress_test/slipfix_sweep.js.

(function (root) {
  // Known OCR confusion pairs, BOTH directions for letter↔digit. Symbol entries whose first
  // char is non-alnum ('$S', '/7', '€E', '£E') are dead in _likelySlip (the symbol branch
  // fires first) and kept only for documentation symmetry.
  // INVARIANT (pinned mechanically in test_slip_fix.js): every BOTH-ALNUM entry is a
  // letter↔digit pair. fusedPairDeletions' mutual-exclusion proof RELIES on this — a future
  // letter↔letter or digit↔digit addition (e.g. 'CG') must re-audit that function first.
  const OCR_PAIRS = new Set(['$S', '5S', 'S5', '0O', 'O0', '0Q', 'Q0', '1I', 'I1', '1L', 'L1',
                             '8B', 'B8', '6G', 'G6', '2Z', 'Z2', '7/', '/7', '€E', '£E']);
  const shapeSig = (s) => s.replace(/[0-9]/g, '#').replace(/[A-Za-z]/g, '@');
  function likelySlip(from, to) {
    if (!/[A-Za-z0-9]/.test(from)) return true;                 // a symbol where alnum is expected
    return OCR_PAIRS.has((from + to).toUpperCase());
  }

  // ── Orientation veto (2026-07-11) ────────────────────────────────────────────────
  // ASCII-only character classes, deliberately: a future Python twin must use explicit ASCII
  // range checks ('0'<=c<='9', 'A'<=c<='Z', 'a'<=c<='z'), NOT str.isalpha() — Unicode-true
  // isalpha() would drift from this /[A-Za-z]/.
  const charClass = (ch) => /[0-9]/.test(ch) ? 'digit' : (/[A-Za-z]/.test(ch) ? 'letter' : null);

  // Classes of the two IMMEDIATELY adjacent positions only — no scanning outward past
  // separators (in "SO-O6820" the letters left of the dash say nothing about the digit
  // block). A separator ('-', '/', ' ', …) or a string EDGE contributes nothing: edges are
  // transparent, so a trailing "…2O"→"…20" fix keeps its one-sided digit evidence (the most
  // common real slip position), while a position with NO alnum neighbour yields the empty
  // set and fails closed.
  // TWO CONSUMERS share this doctrine: wrongWardCrossing (substitution veto) and
  // fusedPairDeletions (deletion orientation). A change here — e.g. "loosen the edges" —
  // widens BOTH at once; re-audit both before touching it.
  function adjacentClasses(v, i) {
    const out = new Set();
    if (i > 0)            { const c = charClass(v[i - 1]); if (c) out.add(c); }
    if (i + 1 < v.length) { const c = charClass(v[i + 1]); if (c) out.add(c); }
    return out;
  }

  // TRUE = suppress. A letter↔digit CLASS-CROSSING proposal is allowed ONLY when the
  // candidate's own alnum neighbourhood is an unambiguous run of the TARGET character's
  // class ({digit} for a →digit fix inside a digit run, {letter} for a →letter heal inside
  // a letter run). Mixed neighbourhood (class seam) and empty neighbourhood fail CLOSED.
  // Non-crossing proposals (the symbol-where-alnum branch, and any future letter↔letter /
  // digit↔digit pair) pass through untouched.
  function wrongWardCrossing(v, i, to) {
    const cFrom = charClass(v[i]), cTo = charClass(to);
    const crossing = (cFrom === 'digit' && cTo === 'letter')
                  || (cFrom === 'letter' && cTo === 'digit');
    if (!crossing) return false;
    const nbr = adjacentClasses(v, i);
    return !(nbr.size === 1 && nbr.has(cTo));
  }

  // ── Fused-pair DELETION slice (2026-07-11 widening) ─────────────────────────────
  // Length-changing garbles ("S0O-51337" for a true "SO-51337") are STRUCTURALLY invisible
  // to the per-position substitution voting (an inserted char shifts every later column),
  // so they get their own gate set. The fusion premise: ONE printed glyph was double-read
  // as TWO mutually-confusable characters (a smudged "O" on a rough scan → "0O"/"O0"), so:
  //   G-FUSE    the deleted char is alnum and ADJACENT to its OCR_PAIRS confusion partner
  //             (case-folded lookup, exactly like likelySlip) — kills genuine series
  //             (SOX-/ROO-/100-) and multi-garbles (S00-: '00'/'S0' are not pairs);
  //   G-WITNESS deleting it lands EXACTLY on an already-learned value (the ONLY admission
  //             branch — domShape is deliberately NOT consulted: shape-alone endorsement is
  //             what powered the substitution inversion, and it would bless mutilating a
  //             genuine "S5A-1234" into a same-shape sibling with zero digit-level evidence);
  //   G-ORIENT  the SURVIVOR's class is what the merged position's own neighbourhood says
  //             lives there — intra-value evidence, immune to in-scope poisoning (deleting
  //             the O of "S0O-51337" toward a poisoned "S0-51337" witness is vetoed by the
  //             garble's own letter 'S').
  // INSERTIONS stay OUT: the premise doesn't run backwards (dropped chars are faint-ink/crop
  // events, not confusion events) and the inserted char's class evidence would be the char
  // we're inventing — circular. Pinned by the length-invariant test.
  //
  // Do NOT funnel orientation through wrongWardCrossing — BOTH tempting reuses are broken:
  // on the FIXED string from==to so `crossing` is false and it degenerates to always-allow;
  // on the ORIGINAL string at the deleted index the survivor is its own adjacent neighbour
  // and votes for its own class, so both directions pass. The only correct formulation is
  // adjacentClasses on the FIXED string at the merged position — the survivor's neighbours
  // there are the pair's ORIGINAL external neighbours, which is also why (with the size-1
  // requirement and the letter↔digit-only pair invariant above) AT MOST ONE deletion
  // direction of a fused pair can ever be admitted: structural mutual exclusion.
  const isAlnum = (ch) => charClass(ch) !== null;
  function fusedPairDeletions(v, valueSet) {
    const hits = new Set();                             // dedupe by resulting fixed string
    for (let i = 0; i < v.length; i++) {
      if (!isAlnum(v[i])) continue;                     // symbols never fuse in this slice
      for (const j of [i - 1, i + 1]) {                 // the partner must be ADJACENT
        if (j < 0 || j >= v.length || !isAlnum(v[j])) continue;
        if (!OCR_PAIRS.has((v[i] + v[j]).toUpperCase())) continue;   // G-FUSE
        const fixed = v.slice(0, i) + v.slice(i + 1);
        if (!valueSet.has(fixed)) continue;             // G-WITNESS
        const mergedPos = Math.min(i, j);               // survivor v[j]'s index in `fixed`
        const nbr = adjacentClasses(fixed, mergedPos);  // G-ORIENT
        if (nbr.size === 1 && nbr.has(charClass(v[j]))) hits.add(fixed);
      }
    }
    return [...hits];
  }

  // "Fix likely slips": find values that differ from a strong per-position column consensus at
  // exactly ONE character, where that character is a likely OCR slip (a symbol where alnum is
  // expected, or a known confusion like $↔S / 0↔O / 1↔I) and the corrected value matches the
  // column's dominant shape or an existing value. Pure/data-driven — proposes, never
  // auto-applies. `rows` is the learning-history shape: [{ value, count }].
  function computeSlipFixes(rowsIn) {
    // Vote WEIGHTED BY OCCURRENCE COUNT (`r.count` = "Times seen"), not one-per-distinct-value.
    // Otherwise a value confirmed 31 times and a one-off OCR slip of it (e.g. "11O2…" vs
    // "1102…") look like a 1-vs-1 tie: no position ever reaches the 80% consensus and the old
    // `< 4 distinct values` gate bailed before voting at all. With counts, the 31x reading is
    // the clear consensus and the 1x "O"→"0" slip is proposed.
    const rows = (rowsIn || [])
      .filter(r => r && typeof r.value === 'string' && r.value.length)
      .map(r => ({ value: r.value, count: Math.max(1, r.count || 1) }));
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    if (rows.length < 2 || totalCount < 4) return [];           // need ≥2 distinct + a real body of confirmations

    const shapeCount = {};
    rows.forEach(r => { const s = shapeSig(r.value); shapeCount[s] = (shapeCount[s] || 0) + r.count; });
    const domShape = Object.entries(shapeCount).sort((a, b) => b[1] - a[1])[0][0];
    const valueSet = new Set(rows.map(r => r.value));
    const out = [];
    for (const r of rows) {
      const v = r.value;
      const diffs = [];
      for (let i = 0; i < v.length; i++) {
        const tally = {}; let total = 0;
        for (const w of rows) {
          if (w.value === v || w.value.length <= i) continue;
          tally[w.value[i]] = (tally[w.value[i]] || 0) + w.count; total += w.count;   // weighted
        }
        if (total < 3) continue;
        const [domChar, domN] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
        if (domN / total >= 0.8 && v[i] !== domChar && likelySlip(v[i], domChar)) diffs.push({ i, to: domChar });
      }
      if (diffs.length === 1) {
        const d = diffs[0], fixed = v.slice(0, d.i) + d.to + v.slice(d.i + 1);
        // The orientation veto sits HERE — after diff collection, gating out.push
        // unconditionally (it covers BOTH admission branches below: a poison literal that
        // coexists with the legit form passes valueSet.has(fixed), and applying it would
        // MERGE the legit row's count into the poison). It must NOT move into the per-
        // position tally loop above: suppressing a diff there could shrink a 2-diff value
        // (which this code rejects at `diffs.length === 1`) down to 1 surviving diff and
        // CREATE a proposal the un-vetoed code never made. Placed here, the output is a
        // provable strict subset of the old proposer's output — suppress-only semantics.
        if (fixed !== v && !wrongWardCrossing(v, d.i, d.to)
            && (shapeSig(fixed) === domShape || valueSet.has(fixed))) out.push({ from: v, to: fixed });
      }
    }

    // ── Fused-pair DELETION pass (additive — rides the same ≥2-distinct/total≥4 gates) ──
    // One proposal per source value, keyed to ADMITTED substitution proposals in `out`,
    // NOT to raw diffs: the live garble itself carries a REJECTED substitution diff
    // (S0O-51337's pos-1 vote → SOO-51337, killed by shape+witness) and must still reach
    // this pass (Oracle C3).
    const srcs = new Set(out.map(p => p.from));
    const dels = [];
    for (const r of rows) {
      if (srcs.has(r.value)) continue;
      const fixes = fusedPairDeletions(r.value, valueSet);
      if (fixes.length === 1) dels.push({ from: r.value, to: fixes[0] });   // G-UNIQUE
    }
    // G-CHAIN: bulk Apply is sequential (renderer lh-apply-fixes) — drop a deletion whose
    // WITNESS is itself being renamed away this click (by a substitution or another
    // deletion), else the operator applies a proposal whose justification the batch just
    // invalidated and the garble lands on a form the tool itself judged a slip.
    const allFrom = new Set([...srcs, ...dels.map(d => d.from)]);
    for (const d of dels) if (!allFrom.has(d.to)) out.push(d);
    return out;
  }

  root.SlipFix = { computeSlipFixes, fusedPairDeletions, wrongWardCrossing, adjacentClasses,
                   charClass, likelySlip, shapeSig, OCR_PAIRS };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.SlipFix).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).SlipFix;
}
