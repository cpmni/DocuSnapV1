'use strict';
/*
 * test_trace_console_straightened.js — the Review trace console (SFDEV) shows the STRAIGHTENED re-read.
 * Run: node src/windows/review/test_trace_console_straightened.js
 *
 * THE BLIND SPOT THIS PINS (owner, 2026-09-25, "why is the date not showing in SFDEV"): the whole-page straighten retry
 * (`DESKEW_REVIEW_RETRY`, process_docs.py) runs a SECOND engine.extract on the straightened page and, when its overall is
 * higher, adopts it whole — the panel then shows that pass's values ("Found '20-01-2025' after straightening — confirm
 * once") while the console showed only the raw pass: "no candidate" on every stage and "—" as the winner. The second
 * extract was called with trace=None. Now:
 *   1. process_docs.py traces the straightened pass tagged `pass: "straightened"` (no slice_dir — crops stay raw) and
 *      emits `deskew_adopt` per changed field + one `deskew_pass` receipt (adopted or kept raw) — only under --trace;
 *   2. the console routes tagged events into a per-field `s2` bucket (never into the raw rows), reads `deskew_adopt`
 *      into the winner line ("… · after straightening (1.6°)") and renders ↻ rows + a doc-level banner.
 * Source-regex pin (both sides), CRLF-safe.
 */
const fs = require('fs');
const path = require('path');
const rend = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const py = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'python_backend', 'process_docs.py'), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

console.log('process_docs.py — the straightened pass is traced and receipted:');
const retry = py.slice(py.indexOf('Straighten+reread: page skew'), py.indexOf('Straighten+reread: FIELD-ADOPTED'));
check('the retry block was found', retry.length > 200);
check('the second extract is traced, tagged pass="straightened", ONLY under --trace',
      /trace=\(\(lambda _ev: emit_trace\(\{\*\*_ev, "pass": "straightened"\}\)\) if args\.trace else None\)/.test(retry));
check('... with no slice_dir (the raw pass\'s crops stay the ones on screen)', /"pass": "straightened"\}\)\) if args\.trace else None\),\s*\n\s*slice_dir=None,/.test(retry));
check('on whole-doc adoption: one deskew_adopt per changed field (was/now/conf/method/angle/overall)',
      /for _k, _w, _n in _chg:[\s\S]{0,400}emit_trace\(\{"event": "deskew_adopt", "field": _k, "was": _w, "now": _n,[\s\S]{0,200}"angle": round\(_max_skew, 2\), "overall_before": _oc0, "overall_after": _oc1\}\)/.test(retry));
check('... and one deskew_pass receipt (adopted: True, changed list)', /emit_trace\(\{"event": "deskew_pass", "adopted": True, "angle": round\(_max_skew, 2\),[\s\S]{0,200}"changed": \[_k for _k, _w, _n in _chg\]\}\)/.test(retry));
check('when kept raw: a deskew_pass receipt with adopted: False and the reason', /emit_trace\(\{"event": "deskew_pass", "adopted": False,[\s\S]{0,200}"reason": \("not-higher" if _raw_flag else "note-only-hold"\)\}\)/.test(retry));
check('ORDERING kept for the C14 pin: apply_holds → raw_extractions = raw2 → the emits (never between them)',
      retry.indexOf('_chg = _deskew_retry_apply_holds(raw_extractions, raw2)') < retry.indexOf('raw_extractions = raw2')
      && retry.indexOf('raw_extractions = raw2') < retry.indexOf('"event": "deskew_adopt"'));
check('emit_trace itself is a no-op without --trace (byte-identical normal processing)', /def emit_trace\(ev: dict\):\s*\n\s*if not args\.trace:\s*\n\s*return/.test(py));

console.log('\nrenderer.js — the console renders that pass:');
const con = rend.slice(rend.indexOf('function render(events) {'), rend.indexOf('function render(events) {') + 30000);
check('deskew_pass is captured doc-level before the per-field guard', /if \(ev\.event === 'deskew_pass'\) \{ deskewPass = ev; continue; \}\s*\n\s*if \(ev\.field == null\) continue;/.test(con));
check('deskew_adopt lands on the field', /if \(ev\.event === 'deskew_adopt'\) \{ get\(ev\.field\)\.deskewAdopt = ev; continue; \}/.test(con));
check('straightened-pass events go into the s2 bucket and NEVER into the raw rows (continue after routing)',
      /if \(ev\.pass === 'straightened'\) \{\s*\n\s*const s2 = get\(ev\.field\)\.s2;\s*\n\s*if \(ev\.event === 'merge'\) s2\.merges\.push\(ev\);\s*\n\s*else if \(ev\.event === 'step'\) s2\.steps\.push\(ev\);\s*\n\s*else if \(ev\.event === 'final'\) s2\.final = ev;\s*\n\s*continue;/.test(con));
check('the winner line reads the adopted value and says "after straightening" with the angle',
      /const finalVal = da \? da\.now : \(m\.final \? m\.final\.value : null\);/.test(con)
      && /· <b>after straightening<\/b> \(\$\{escHtml\(String\(da\.angle\)\)\}°\)/.test(con));
check('an ↻ adopted row names what the raw pass read (or "nothing"), the skew and the overall change, and the confirm-once hold',
      /noteRow\('↻ adopted'/.test(con) && /raw pass read \$\{d\.was != null && d\.was !== '' \? escHtml\(shown\(d\.was\)\) : 'nothing'\}/.test(con) && /held to confirm once/.test(con));
check('↻ stage rows show the straightened pass\'s merges and step outcomes (one per stage)', /noteRow\(`↻ \$\{STAGE_LABEL\[c\.stage\] \|\| c\.stage\}`/.test(con) && /noteRow\(`↻ \$\{STAGE_LABEL\[st\.stage\] \|\| st\.stage\}`/.test(con));
check('a doc-level banner says adopted (with the changed fields) or kept raw (with the reason), and that crops are the raw pass\'s',
      /const banner = deskewPass/.test(con) && /Straightened re-read <b>adopted<\/b>/.test(con) && /but was <b>kept raw<\/b>/.test(con) && /the crops shown are the raw pass's/.test(con)
      && /elFields\.innerHTML = banner \+ blocks\.join\(''\);/.test(con));
check('the empty-field placeholders still know the new buckets (EMPTY_M carries s2 + deskewAdopt)', /const EMPTY_M = \{[^}]*glyph: null,\s*\n\s*s2: \{ merges: \[\], steps: \[\], final: null \}, deskewAdopt: null \};/.test(con));

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
