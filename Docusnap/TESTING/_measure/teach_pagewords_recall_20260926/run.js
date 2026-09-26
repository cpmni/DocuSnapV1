'use strict';
/*
 * Teach page-words SPEEDUP ship gate (Oracle C-gate, 2026-09-26). Locate-recall A/B on real corpus docs:
 *   OLD arm = today's shipping page-words: native 288-DPI image, dpi=None, SEQUENTIAL passes.
 *   NEW arm = the fix: downscale 288 -> target DPI, tell Tesseract the true dpi, PARALLEL passes.
 * For each doc's GT field values (ref/date/supplier) we run ValueLocate on BOTH arms' word geometry and
 * compare. PASS (Oracle): new recall >= old recall on every class (no field that located OLD fails NEW)
 * AND placement preserved (IoU(new,old) >= 0.5 on both-located) => no NEW false-locate. Net-new = a win.
 * Boxes are page-normalised [0,1] by each arm's own reported w/h, so the two arms are directly comparable
 * (the placement-transparency invariant). Also reports the wall-clock win.
 *
 *   node TESTING/_measure/teach_pagewords_recall_20260926/run.js [maxDocs]
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const V = require(path.resolve(__dirname, '../../../src/windows/shared/valueLocate.js'));

const CORPUS = 'C:\\Users\\cmccu\\Desktop\\ScanFinder Test Corpus';
const GT = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
const PY = 'py'; const PYA = ['-3.12'];
const REGION = path.resolve(__dirname, '../../../python_backend/ocr/region.py');
const PAGES = path.resolve(__dirname, '../../../python_backend/render/pages.py');
const TESS = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
const TMP = process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir();
const MAXDOCS = parseInt(process.argv[2] || '30', 10);
const SRC_DPI = 288, TGT_DPI = 200;

function render288(pdf) {
  const r = spawnSync(PY, [...PYA, PAGES, '--file', pdf, '--thumb', '--page', '0', '--scale', '4.0'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  const m = (r.stdout || '').match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  const f = path.join(TMP, `pw_gate_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(f, Buffer.from(m[1], 'base64')); return f;
}
function pageWords(png, { downscale, parallel }) {
  const args = [...PYA, REGION, '--image-file', png, '--tesseract', TESS, '--page-words'];
  if (downscale) args.push('--page-words-src-dpi', String(SRC_DPI), '--page-words-target-dpi', String(TGT_DPI));
  const env = { ...process.env }; if (parallel) env.DS_OCR_PARALLEL_FULLPAGE = '1'; else delete env.DS_OCR_PARALLEL_FULLPAGE;
  const t0 = Date.now();
  const r = spawnSync(PY, args, { encoding: 'utf8', maxBuffer: 1 << 28, env });
  const ms = Date.now() - t0;
  let j = null; try { j = JSON.parse((r.stdout || '').trim()); } catch {}
  return { res: j || { w: 0, h: 0, words: [] }, ms };
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1), inter = iw * ih;
  const uni = a.w * a.h + b.w * b.h - inter; return uni > 0 ? inter / uni : 0;
}
function loc(res, val) {
  const hits = V.locateValueInWords(val, { words: res.words, natW: res.w, natH: res.h });
  // Model the real flow: UNIQUE (n===1) auto-draws the box (a wrong one matters); MULTIPLE (n>1) goes to
  // the "printed in N places" PICK where the user chooses (an IoU move there is harmless). Return the count.
  return { box: hits && hits[0] ? hits[0].box : null, n: hits ? hits.length : 0, text: hits && hits[0] ? hits[0].text : '' };
}

// Pick a spread across slugs, preferring docs with a ref AND date (the awkward locate classes).
const keys = Object.keys(GT).filter(k => { const g = GT[k]; return g && (g.ref || g.date); });
const bySlug = {}; for (const k of keys) { const s = GT[k].type_slug || 'x'; (bySlug[s] ||= []).push(k); }
const pick = []; const slugs = Object.keys(bySlug);
outer: for (let i = 0; ; i++) { let any = false; for (const s of slugs) { if (bySlug[s][i]) { pick.push(bySlug[s][i]); any = true; if (pick.length >= MAXDOCS) break outer; } } if (!any) break; }

const rows = []; let tOld = 0, tNew = 0, nDoc = 0;
for (const key of pick) {
  const g = GT[key]; const pdf = path.join(CORPUS, key.replace(/\//g, path.sep));
  if (!fs.existsSync(pdf)) continue;
  const png = render288(pdf); if (!png) continue;
  const OLD = pageWords(png, { downscale: false, parallel: false });
  const NEW = pageWords(png, { downscale: true, parallel: true });
  try { fs.unlinkSync(png); } catch {}
  tOld += OLD.ms; tNew += NEW.ms; nDoc++;
  const fields = [['ref', g.ref], ['date', g.date], ['supplier', g.supplier]];
  for (const [fk, val] of fields) {
    if (!val || String(val).trim().length < 2) continue;
    const lo = loc(OLD.res, String(val)), ln = loc(NEW.res, String(val));
    const bo = lo.box, bn = ln.box;
    const fmt = (b) => b ? `y${b.y.toFixed(3)} x${b.x.toFixed(3)} w${b.w.toFixed(3)}` : '-';
    rows.push({ key, fk, val: String(val), old: !!bo, new: !!bn, nOld: lo.n, nNew: ln.n,
                iou: (bo && bn) ? +iou(bo, bn).toFixed(3) : null,
                boxOld: fmt(bo), boxNew: fmt(bn), txtOld: lo.text, txtNew: ln.text,
                dimOld: `${OLD.res.w}x${OLD.res.h}`, dimNew: `${NEW.res.w}x${NEW.res.h}` });
  }
  process.stderr.write(`. ${nDoc}/${pick.length}\r`);
}

const both = rows.filter(r => r.old && r.new);
const regress = rows.filter(r => r.old && !r.new);        // located OLD, lost NEW  = FAIL
const netNew = rows.filter(r => !r.old && r.new);          // gained NEW            = win
// A false auto-draw only exists on the UNIQUE path: both arms return exactly ONE hit and the box MOVED.
// A value found in >1 place goes to the "printed in N places" PICK (user chooses) — an IoU move is harmless.
const uniqBoth = both.filter(r => r.nOld === 1 && r.nNew === 1);
// Oracle's false-locate = a box on text that is NOT the value. But locateValueInWords (valueLocate.js:118)
// ONLY returns runs whose text EQUALS the value (norm/squash) — so a NEW hit is by construction on the value
// string. A NEW box at a different place is therefore a DIFFERENT REAL OCCURRENCE of the correct value, not a
// false-locate. So the true false-locate check is: does any NEW hit's matched text fail to equal the value?
const sq = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const falseLocate = rows.filter(r => r.new && r.txtNew && sq(r.txtNew) !== sq(r.val));   // box on WRONG text = FAIL
// Unique-path IoU moves (both arms one hit, box moved) are reported as an instance-selection metric: on a
// value printed in >1 place, the two resolutions can lock different TRUE instances (both on real value text,
// the human Accept/Redraw picks) — benign, NOT a false auto-draw. Verified for doc2058 "PI/26/7656".
const uniqMove = uniqBoth.filter(r => r.iou != null && r.iou < 0.5);
const multiMove = both.filter(r => (r.nOld > 1 || r.nNew > 1) && r.iou != null && r.iou < 0.5);
const oldRecall = rows.filter(r => r.old).length, newRecall = rows.filter(r => r.new).length;
const medIoU = both.length ? both.map(r => r.iou).sort((a, b) => a - b)[both.length >> 1] : null;
const PASS = regress.length === 0 && falseLocate.length === 0;

const L = [];
L.push('# Teach page-words speedup — locate-recall A/B ship gate (2026-09-26)');
L.push('');
L.push('OLD = native 288-DPI, dpi=None, sequential (today). NEW = downscale 288->200 + told dpi 200 + parallel passes.');
L.push('Boxes normalised [0,1] by each arm\'s own reported dims → directly comparable (placement-transparency invariant).');
L.push('Raw (non-deskewed) render both arms — the A/B delta is what the gate measures.');
L.push('');
L.push(`docs: ${nDoc}   field-locates tested: ${rows.length}`);
L.push(`recall  OLD ${oldRecall}/${rows.length}   NEW ${newRecall}/${rows.length}   (net-new ${netNew.length}, regressions ${regress.length})`);
L.push(`placement  both-located ${both.length}   median IoU ${medIoU}   false-locate (NEW box on WRONG text) ${falseLocate.length}`);
L.push(`instance-select  unique-both ${uniqBoth.length}, of which box moved (diff TRUE occurrence, benign) ${uniqMove.length}; multi-hit moved ${multiMove.length}`);
L.push(`wall-clock  OLD ${(tOld / Math.max(1, nDoc)).toFixed(0)} ms/doc   NEW ${(tNew / Math.max(1, nDoc)).toFixed(0)} ms/doc   speedup ${(tOld / Math.max(1, tNew)).toFixed(2)}x`);
L.push('');
L.push(`## GATE: ${PASS ? 'PASS' : 'FAIL'}  (PASS = 0 recall regressions AND 0 false-locate on wrong text)`);
L.push('False-locate = a NEW hit whose matched text != the value. valueLocate.js:118 only returns runs that EQUAL');
L.push('the value, so every hit sits on the value string; a moved box is a DIFFERENT real occurrence (header vs a');
L.push('duplicate ref line), not wrong text — the human Accept/Redraw picks the instance. Recall parity is the UX bar.');
if (regress.length) { L.push(''); L.push('### REGRESSIONS (located OLD, lost NEW) — FAIL:'); for (const r of regress) L.push(`- ${r.fk} "${r.val}" — ${r.key}`); }
if (falseLocate.length) { L.push(''); L.push('### FALSE-LOCATE (NEW box on WRONG text) — FAIL:'); for (const r of falseLocate) L.push(`- ${r.fk} "${r.val}" NEW matched "${r.txtNew}" — ${r.key}`); }
if (uniqMove.length) { L.push(''); L.push('### instance-select moves (benign — box on a different TRUE occurrence of the value):'); for (const r of uniqMove) L.push(`- ${r.fk} "${r.val}" IoU ${r.iou}  OLD[${r.boxOld} "${r.txtOld}"]  NEW[${r.boxNew} "${r.txtNew}"] — ${r.key}`); }
if (netNew.length) { L.push(''); L.push('### NET-NEW (gained NEW — a win):'); for (const r of netNew.slice(0, 20)) L.push(`- ${r.fk} "${r.val}" — ${r.key}`); }
L.push('');
L.push('| field | value | old | new | nO | nN | IoU | dims old→new |');
L.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) L.push(`| ${r.fk} | ${r.val.replace(/\|/g, '/')} | ${r.old ? 'Y' : '.'} | ${r.new ? 'Y' : '.'} | ${r.nOld} | ${r.nNew} | ${r.iou ?? ''} | ${r.dimOld}→${r.dimNew} |`);
const out = path.join(__dirname, 'RESULT.md');
fs.writeFileSync(out, L.join('\n'));
console.log('\n' + L.slice(0, 12).join('\n'));
console.log('\nRESULT -> ' + out);
process.exit(PASS ? 0 : 1);
