'use strict';
/*
 * test_hold_reason_truthful.js — Review must state the REAL reason a document is held, never one
 * re-derived from the confidence threshold. Run: node src/windows/review/test_hold_reason_truthful.js
 *
 * THE BUG (Oracle, 2026-07-20 — merge precondition for the trust-gate change).
 * `renderCleanHoldReason` derived its message from `overall_confidence` vs `auto_file_threshold`
 * and carried the comment "truthful by construction: a clean doc that is WAITING always sits below
 * the user's threshold". That invariant is FALSE the moment graduation is active: a trusted scope's
 * effective floor is min(userThreshold, 95), so a doc at 97 sits ABOVE its floor and is held by the
 * structural gate instead. The copy was then wrong in BOTH directions:
 *   • held by the gate, threshold at 100 → "just below the 100% you've set — lower the threshold",
 *     which cannot help: the gate refuses at ANY floor;
 *   • held by the gate, threshold at 95   → falls to the else branch → cue "Ready to file",
 *     asserting readiness for a document the predicate had just refused.
 * Measured on the owner's live DB: 4 documents were showing the first message at the time.
 *
 * THE FIX: a `get-auto-file-reason` IPC returns the SAME predicate's verdict (kind + field), and
 * the panel speaks from that. The threshold copy survives only for a genuine below-floor hold.
 */
const fs   = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const renderer = read('renderer.js');
const preload  = read('..', '..', 'preload.js');
const handler  = read('..', '..', 'modules', 'review', 'handler.js');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

console.log('main — the authoritative verdict is exposed:');
check('get-auto-file-reason IPC exists', handler.includes("ipcMain.handle('get-auto-file-reason'"));
check('it is access-gated like the rest of the review admin surface',
      /get-auto-file-reason[\s\S]{0,220}requireRole\('admin', 'edit'\)/.test(handler));
check('it returns the SAME predicate, not a re-implementation',
      /get-auto-file-reason[\s\S]{0,600}trust\.isAutoFileEligible\(db, doc\)/.test(handler));
check('the reason is split into kind + field so the renderer never parses it',
      /get-auto-file-reason[\s\S]{0,700}split\(':'\)/.test(handler));
check('preload bridges it', preload.includes("getAutoFileReason") && preload.includes("'get-auto-file-reason'"));

console.log('\nrenderer — the panel speaks from the verdict:');
const fn = renderer.slice(renderer.indexOf('function renderCleanHoldReason'));
const body = fn.slice(0, fn.indexOf('function renderReviewReason'));
const idxVerdict = body.indexOf('_holdVerdict');
// Anchor on the COMPARISON that produces the threshold copy, not on the `const thr = …`
// declaration at the top of the function — the declaration is not the claim.
const idxThresh  = body.indexOf('Number.isFinite(conf) && conf < thr');
check('renderCleanHoldReason consults the real verdict', idxVerdict > -1);
check('ORDERING: the verdict is consulted BEFORE the threshold-derived copy',
      idxVerdict > -1 && idxThresh > -1 && idxVerdict < idxThresh);
check('a gate hold explicitly says the confidence setting is NOT the lever',
      /isn't the confidence setting|won't file this one/.test(body));
check("a below-floor hold is EXCLUDED from the verdict branch (the threshold copy is right there)",
      /v\.kind !== 'below-floor'/.test(body));
check('the blocking field is named for the user', body.includes('_holdFieldLabel'));

console.log('\nrenderer — the verdict cannot be shown against the wrong document:');
check('the stale verdict is cleared before each fetch', renderer.includes('_holdVerdict = null;'));
check('a late reply for a different doc is dropped',
      /currentDoc\.id !== _forDoc\) return;/.test(renderer));
check('only WAITING docs are queried (a confirmed doc is not being held)',
      /_holdVerdict = null;[\s\S]{0,200}status === 'needs_review' \|\| doc\.status === 'deferred'/.test(renderer));

console.log('\nthe false comment is gone:');
check('the "truthful by construction" claim no longer stands unqualified',
      !/Truthful by construction: the effective floor is min\(user threshold, graduation floor\), so a\s*\/\/ clean doc that is WAITING always sits below/.test(renderer));
check('…and the file records WHY it was false', /FALSE whenever graduation is active/.test(renderer));

// ── weak-critical-field copy (2026-07-23, Oracle C7 of the corroboration-lift sign-off) ──
// The critical-floor hold used to fall to the generic "an automatic check didn't pass" —
// the one hold kind whose copy DIDN'T name the field (the owner's 4 held invoices). The map
// entry must name the field from the real verdict and carry NO threshold advice (the floor
// applies at every threshold; the shared hint already says the setting can't file it).
console.log('\nweak-critical-field names the field (was the generic fallback):');
check("the map carries a 'weak-critical-field' entry", renderer.includes("'weak-critical-field':"));
{
  const i = renderer.indexOf("'weak-critical-field':");
  const entry = renderer.slice(i, renderer.indexOf('}[v.kind]', i));
  check('the copy names the blocking field (fieldName interpolated)', /fieldName\s*\?/.test(entry) && entry.includes('${escHtml(fieldName)}'));
  check('no threshold advice in the copy (the floor applies at EVERY threshold)',
        !/threshold|Settings → Processing|confidence setting/i.test(entry));
  check('the generic fallback survives for unknown kinds', renderer.includes("|| 'an automatic check didn\\'t pass.'"));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll hold-reason truthfulness checks passed');
process.exit(fails ? 1 : 0);
