'use strict';
// Guards src/windows/shared/slipFix.js — the "Fix likely slips" proposer + the ORIENTATION VETO
// added after the 2026-07-11 live inversion incident (a poisoned in-scope majority made the old
// majority-ward proposer rename the LEGIT values into the poison). Every suppression pinned here
// is deliberate: deleting the veto, moving it into the tally loop, or "simplifying" any pin
// below RESTORES a proven-live data-corruption bug.
//   node src/windows/shared/test_slip_fix.js
global.window = global;                 // the module attaches to `window`
const S = require('./slipFix');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const rows = (pairs) => pairs.map(([value, count]) => ({ value, count }));
const propStr = (out) => out.map(p => `${p.from}→${p.to}`).sort().join(', ') || '(none)';

// Length-invariant collector (Oracle C2b, 2026-07-11 deletion slice): intercept every
// computeSlipFixes call in this file so the global pin at the bottom can assert
// from.length ∈ {to.length, to.length+1} over EVERY fixture — substitutions same-length,
// fused-pair deletions exactly one shorter, and any INSERTION (to longer than from) is an
// instant failure. Pins insertions-out mechanically, not just by prose.
const _allProposals = [];
{
  const _orig = S.computeSlipFixes;
  S.computeSlipFixes = (r) => { const o = _orig(r); _allProposals.push(...o); return o; };
}

// ── THE PIN — the 2026-07-11 inversion, exactly as it fired live ────────────────────────────
// (Bramble & Finch, sales_order, sales_order_number): poisoned majority S0-* (zero) at count 4
// vs the two LEGIT SO-* (letter O) values. Position-1 tally vs each legit candidate is 4-vs-1
// = 80% exactly → the OLD code proposed BOTH wrong-ward renames (SO-66820→S0-66820,
// SO-27481→S0-27481) and renamed the legit learning INTO the poison. The veto must silence it:
// the candidate's own neighbourhood at position 1 is {letter} ('S' left, '-' contributes
// nothing), which does not support a →digit crossing.
{
  const out = S.computeSlipFixes(rows([['S0-55005', 2], ['S0-51337', 2], ['SO-66820', 1], ['SO-27481', 1]]));
  check(`inversion pin: poisoned 80% majority → ZERO proposals (got ${propStr(out)})`, out.length === 0);
}
// 100%-poisoned variant — today's live scope shape after two more zero-form confirms. The
// orientation evidence is intra-value, so it holds with NO in-scope minority surviving.
{
  const out = S.computeSlipFixes(rows([['S0-66820', 2], ['S0-55005', 2], ['S0-33736', 2], ['SO-27481', 1]]));
  check(`inversion pin at 100% poison → ZERO proposals (got ${propStr(out)})`, out.length === 0);
}

// ── Must-survive: the tool's raison d'être ──────────────────────────────────────────────────
// Interior digit-run slip against a count-weighted 31×-vs-1× consensus (the case the count-
// weighting comment in the proposer was written for). Neighbourhood {digit,digit} supports →0.
{
  const out = S.computeSlipFixes(rows([['1102V03NL1', 31], ['11O2V03NL1', 1]]));
  check(`raison d'être: 11O2V03NL1 → 1102V03NL1 still proposed (got ${propStr(out)})`,
        out.length === 1 && out[0].from === '11O2V03NL1' && out[0].to === '1102V03NL1');
}
// Symbol-where-alnum branch untouched ($ is not a letter↔digit crossing → veto inert).
{
  const out = S.computeSlipFixes(rows([['SO2', 5], ['$O2', 1]]));
  check(`symbol branch: $O2 → SO2 still proposed (got ${propStr(out)})`,
        out.length === 1 && out[0].from === '$O2' && out[0].to === 'SO2');
}
// HEAL direction under a HEALTHY majority — proves the veto is orientation-aware, not
// pair-banning: the digit→letter fix inside the leading letter-run is supported by {letter}.
{
  const out = S.computeSlipFixes(rows([['SO-11111', 6], ['SO-33333', 5], ['S0-22222', 1]]));
  check(`heal direction: S0-22222 → SO-22222 still proposed (got ${propStr(out)})`,
        out.length === 1 && out[0].from === 'S0-22222' && out[0].to === 'SO-22222');
}

// ── Oracle T1 — the veto must sit AFTER diff collection, never inside the tally loop ────────
// Candidate SO-1I111 has TWO ≥80% diffs: position 1 (O→0, vetoable crossing) and position 4
// (I→1, legit digit-run fix). The old code rejected it at `diffs.length === 1`; the new code
// must too. HAZARD PINNED: a veto moved INTO the tally loop would drop the position-1 diff,
// collapse 2→1, and CREATE the proposal SO-1I111→SO-11111 (valueSet.has admits it) — a
// proposal the un-vetoed code never made, violating strict-subset/suppress-only semantics.
// (The fixture's third row SO-11111 also draws its own wrong-ward 80% proposal →S0-11111,
// which the veto silences — so the assert is ZERO total.)
{
  const out = S.computeSlipFixes(rows([['S0-11111', 4], ['SO-11111', 1], ['SO-1I111', 1]]));
  check(`T1 two-diff value stays unproposed + wrong-ward silenced (got ${propStr(out)})`, out.length === 0);
}

// ── Oracle T2 — the veto gates BOTH admission branches (valueSet, not just domShape) ────────
// domShape here is the long value's (@#-#########, count 12), so the wrong-ward fix
// 'S0-51337' fails the shape branch — but it EXISTS in-scope, so valueSet.has(fixed) admits
// it (and applying would MERGE the legit row's count into the poison row). Must be silenced.
{
  const out = S.computeSlipFixes(rows([['S0-999999999', 12], ['S0-51337', 4], ['SO-51337', 1]]));
  check(`T2 valueSet-branch wrong-ward crossing silenced (got ${propStr(out)})`, out.length === 0);
}

// ── Oracle T4 — string-edge semantics (transparent edges, per the arbitration) ──────────────
// TRAILING slip: last char, left neighbour '2' is real digit evidence, the edge contributes
// nothing → {digit} supports →0. This is the single most common real slip position; gary's
// stricter fail-closed-edges variant was REJECTED because it silences exactly this.
{
  const out = S.computeSlipFixes(rows([['SO-66820', 10], ['SO-6682O', 1]]));
  check(`T4 trailing …2O → …20 still proposed (got ${propStr(out)})`,
        out.length === 1 && out[0].from === 'SO-6682O' && out[0].to === 'SO-66820');
}
// LEADING slip: first char, right neighbour '3' digit → supported.
{
  const out = S.computeSlipFixes(rows([['0345', 5], ['O345', 1]]));
  check(`T4 leading O345 → 0345 still proposed (got ${propStr(out)})`,
        out.length === 1 && out[0].from === 'O345' && out[0].to === '0345');
}
// DELIBERATE RESIDUAL (reggie's row 14, Oracle-accepted): a format whose TRUE value ends in
// letter O after digits, under an ≥80% poisoned majority, still draws the digit-ward proposal
// — the local prior reads the neighbourhood ({digit}), not the truth. Doubly rare in real
// numbering schemes (trailing O/I deliberately avoided BECAUSE humans confuse them) and it
// additionally needs a majority of mis-confirms. CURE = the deferred cross-scope corroboration
// slice, NOT a stricter local rule (that trades away the trailing-slip class above). If this
// check starts failing because the proposal disappeared, the corroboration slice landed — move
// the pin there; do not silently re-loosen.
{
  const out = S.computeSlipFixes(rows([['120', 6], ['12O', 1]]));
  check(`T4 residual pinned: true-trailing-letter world still proposes 12O→120 (got ${propStr(out)})`,
        out.length === 1 && out[0].from === '12O' && out[0].to === '120');
}
// ACCEPTED NARROWING (both designs share it): an interior slip at a CLASS SEAM (neighbours
// 'V' and '3' → mixed set) is no longer proposable — fail closed at letter/digit boundaries.
// Was proposable before the veto; manual ✎ rename remains the path.
{
  const out = S.computeSlipFixes(rows([['1102V03NL1', 31], ['1102VO3NL1', 1]]));
  check(`T4 class-seam narrowing: …VO3… stays silent (got ${propStr(out)})`, out.length === 0);
}

// ── Trade-off pin — the true-zero-format world ──────────────────────────────────────────────
// A supplier whose TRUE format really is S0-##### (digit zero in the letter run): the legit
// heal-ward fix SO-22222→S0-22222 is silenced too. DELIBERATE: in-scope data cannot
// distinguish this world from the inversion, and the approved bias is "propose NOTHING rather
// than invert". Manual ✎ rename remains.
{
  const out = S.computeSlipFixes(rows([['S0-11111', 10], ['SO-22222', 1]]));
  check(`true-zero-format supplier → silence (got ${propStr(out)})`, out.length === 0);
}

// ── Predicate units (wrongWardCrossing: true = suppress) ────────────────────────────────────
check('unit: SO-66820 @1 →0 suppressed (letter-run, the incident)', S.wrongWardCrossing('SO-66820', 1, '0') === true);
check('unit: S0-66820 @1 →O allowed (heal into letter-run)',        S.wrongWardCrossing('S0-66820', 1, 'O') === false);
check('unit: 11O2V03NL1 @2 →0 allowed (digit-run interior)',        S.wrongWardCrossing('11O2V03NL1', 2, '0') === false);
check('unit: WS7O3182 @3 →0 allowed (digit-run of mixed code)',     S.wrongWardCrossing('WS7O3182', 3, '0') === false);
check('unit: A-O-1 @2 →0 suppressed (separator-sandwiched, empty evidence fails closed)',
      S.wrongWardCrossing('A-O-1', 2, '0') === true);
check('unit: $O2 @0 →S passes through (symbol from-char, not a crossing)',
      S.wrongWardCrossing('$O2', 0, 'S') === false);
check('unit: SO66820 @1 →0 suppressed (unhyphenated letter/digit seam, mixed evidence)',
      S.wrongWardCrossing('SO66820', 1, '0') === true);

// ── Gates unchanged ─────────────────────────────────────────────────────────────────────────
check('gate: single distinct value → no proposals', S.computeSlipFixes(rows([['SO2', 9]])).length === 0);
check('gate: totalCount < 4 → no proposals',        S.computeSlipFixes(rows([['SO2', 2], ['S02', 1]])).length === 0);
check('gate: empty/null rows → no proposals',       S.computeSlipFixes(null).length === 0 && S.computeSlipFixes([]).length === 0);

// ═══ Fused-pair DELETION slice (2026-07-11 widening — reggie design, Oracle-conditioned) ═══
// Length-changing garbles are invisible to the substitution voting; the deletion pass admits
// a heal ONLY through G-FUSE (deleted char adjacent to its confusion partner) + G-WITNESS
// (result exactly equals an already-learned value) + G-ORIENT (survivor's class = the merged
// position's own neighbourhood) + G-UNIQUE + G-CHAIN. Deleting any of these gates restores a
// documented FP or wrong-ward route — every silence below is deliberate.

// THE LIVE PAIR (2026-07-11): the garble S0O-51337 was confirmed beside its true form
// SO-51337. Delete-'0' lands on the witness with letter-run support; delete-'O' has no
// witness. Exactly one proposal, the right one.
{
  const out = S.computeSlipFixes(rows([['S0O-51337', 1], ['SO-51337', 1], ['SO-66820', 2],
                                       ['SO-27481', 1], ['SO-33736', 1], ['SO-55005', 1]]));
  check(`DEL live pair: S0O-51337 → SO-51337 proposed, nothing else (got ${propStr(out)})`,
        out.length === 1 && out[0].from === 'S0O-51337' && out[0].to === 'SO-51337');
}
// POISONED-WITNESS VETO: the zero form S0-51337 EXISTS in-scope (poisoned world) — the
// delete-'O' route toward it is vetoed by the garble's OWN letter 'S' (G-ORIENT), and the
// delete-'0' route has no letter witness. Total silence; never invert.
{
  const out = S.computeSlipFixes(rows([['S0O-51337', 1], ['S0-51337', 2], ['S0-66820', 2]]));
  check(`DEL poisoned witness: delete-O toward S0-51337 vetoed → silence (got ${propStr(out)})`, out.length === 0);
}
// FULL-POISON world (letter forms purged entirely): still total silence.
{
  const out = S.computeSlipFixes(rows([['S0O-51337', 1], ['S0-51337', 2], ['S0-55005', 2], ['S0-33736', 2]]));
  check(`DEL full poison → total silence (got ${propStr(out)})`, out.length === 0);
}
// MULTI-GARBLE pin: S00-51337 is distance 2 from the truth; '00'/'S0' are not confusion
// pairs, so G-FUSE keeps it silent EVEN with the poison witness S0-51337 present. Manual ✎.
{
  const out = S.computeSlipFixes(rows([['S00-51337', 1], ['S0-51337', 2], ['S0-66820', 2]]));
  check(`DEL S00 multi-garble stays silent even beside a poison witness (got ${propStr(out)})`, out.length === 0);
}
// Digit-run fusion ('O' double-read beside '0' inside a digit run) — also exercises Oracle
// C3: this garble carries a REJECTED substitution diff (pos-9 L→1 vote, killed by shape),
// and must still reach the deletion pass (srcs is keyed to ADMITTED proposals only).
{
  const out = S.computeSlipFixes(rows([['1102V03NL1', 31], ['110O2V03NL1', 1]]));
  check(`DEL digit-run fusion: 110O2V03NL1 → 1102V03NL1 (got ${propStr(out)})`,
        out.length === 1 && out[0].from === '110O2V03NL1' && out[0].to === '1102V03NL1');
}
// Genuine-series FP guards — a shorter sibling in-scope must NEVER invite mutilating the
// longer series: G-FUSE has no pair for X/O-doubles/0-doubles.
check('DEL genuine series SOX-1234 beside SO-1234 → silence',
      S.computeSlipFixes(rows([['SOX-1234', 3], ['SO-1234', 2]])).length === 0);
check('DEL genuine series ROO-123 beside RO-123 → silence',
      S.computeSlipFixes(rows([['ROO-123', 3], ['RO-123', 2]])).length === 0);
check('DEL genuine series 100-456 beside 10-456 → silence',
      S.computeSlipFixes(rows([['100-456', 3], ['10-456', 2]])).length === 0);
// Unhyphenated letter/digit seam: the merged position sees {letter,digit} → fails closed
// (mirrors the substitution veto's seam pin).
{
  const out = S.computeSlipFixes(rows([['S0O66820', 1], ['SO66820', 3]]));
  check(`DEL unhyphenated seam S0O66820 → silence (got ${propStr(out)})`, out.length === 0);
}
// Separator-sandwiched pair: the merged position has NO alnum neighbour → empty set fails
// closed, even with a perfect witness.
{
  const out = S.computeSlipFixes(rows([['A-0O-1', 1], ['A-0-1', 3]]));
  check(`DEL separator-sandwiched → silence (got ${propStr(out)})`, out.length === 0);
}
// G-UNIQUE: a value with TWO distinct admissible deletions (two independent fused pairs,
// each with its own witness) proposes NOTHING — ambiguity is silence.
{
  const out = S.computeSlipFixes(rows([['10O2-S0OB', 1], ['102-S0OB', 2], ['10O2-SOB', 2]]));
  check(`DEL G-UNIQUE two admissible results → silence (got ${propStr(out)})`, out.length === 0);
}
// DELIBERATE RESIDUAL (reggie row 14, Oracle-accepted): a GENUINE fused-signature value
// (S5A-1234, real S+5 adjacency) whose digit-exact witness SA-1234 happens to be learned
// in-scope IS proposed — a three-coincidence FP backstopped by the preview+Cancel gate and
// ✎ undo. If this check starts failing because the proposal disappeared, the cross-scope
// corroboration slice landed — move the pin there; do not silently re-loosen G-WITNESS.
{
  const out = S.computeSlipFixes(rows([['S5A-1234', 1], ['SA-1234', 3]]));
  check(`DEL S5A residual pinned as deliberately-still-firing (got ${propStr(out)})`,
        out.length === 1 && out[0].from === 'S5A-1234' && out[0].to === 'SA-1234');
}
// G-CHAIN: the witness SO-6682O is itself being renamed this click (trailing-slip
// substitution → SO-66820), so the deletion S0O-6682O→SO-6682O is DROPPED — the batch
// would otherwise apply a proposal whose justification it just invalidated. Only the
// substitution survives.
{
  const out = S.computeSlipFixes(rows([['SO-66820', 10], ['SO-6682O', 1], ['S0O-6682O', 1]]));
  check(`DEL G-CHAIN drops deletion onto a mid-batch-renamed witness (got ${propStr(out)})`,
        out.length === 1 && out[0].from === 'SO-6682O' && out[0].to === 'SO-66820');
}
// Mutual-exclusion unit: with BOTH witnesses present, only the letter-ward deletion of the
// fused pair is admissible — the two directions share the same external neighbourhood, so
// the size-1 orientation requirement can match at most one survivor class.
{
  const fixes = S.fusedPairDeletions('S0O-51337', new Set(['SO-51337', 'S0-51337']));
  check(`DEL mutual exclusion: both witnesses → only SO-51337 (got ${fixes.join(', ') || '(none)'})`,
        fixes.length === 1 && fixes[0] === 'SO-51337');
}

// ── Mechanical pins (Oracle C2) ─────────────────────────────────────────────────────────────
// (a) Every BOTH-ALNUM confusion pair is letter↔digit — fusedPairDeletions' mutual-exclusion
// proof RELIES on it. A letter↔letter/digit↔digit addition must re-audit that function.
{
  let bad = [];
  for (const pair of S.OCR_PAIRS) {
    const a = S.charClass(pair[0]), b = S.charClass(pair[1]);
    if (a && b && a === b) bad.push(pair);
  }
  check(`pin: OCR_PAIRS both-alnum entries are all letter↔digit (violations: ${bad.join(', ') || 'none'})`,
        bad.length === 0);
}
// (b) Global length invariant over EVERY proposal produced by EVERY fixture in this file:
// substitutions are same-length, deletions exactly one shorter — an insertion (to longer
// than from) anywhere is a failure. Pins insertions-out.
{
  const bad = _allProposals.filter(p => !(p.from.length === p.to.length || p.from.length === p.to.length + 1));
  check(`pin: length invariant from.length ∈ {to.length, to.length+1} over ${_allProposals.length} proposals`
        + (bad.length ? ` (violations: ${bad.map(p => `${p.from}→${p.to}`).join(', ')})` : ''),
        _allProposals.length > 0 && bad.length === 0);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
