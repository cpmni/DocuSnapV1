'use strict';
/*
 * test_list_field_pills.js — the LIST field Review slice (2026-08-27; panel barry/gary/reggie/eric/bob/
 * Chris → Oracle SIGN-OFF-W/COND, docs/oracle_log.md).
 *
 * OWNER ASK (verbatim intent): "there is a text box on the list type field. This should maybe be more of
 * a text display of the detected values?? With the option to state if there is a problem… maybe 9 are
 * good but 1 is bad… should it let them manually edit to the correct value? Should there be an option
 * to do something that would enhance teaching of this field in future?"
 *
 * WHAT SHIPPED. Pills as a VIEW over the hidden store input (the ONE value confirm reads, the ONE
 * `corrections` writer); per-pill edit / ✕ with put-back / "+ One it missed" (= the ⊕ caption teach) /
 * "Edit as text" / "Undo changes". Learning from a pill edit is THIS DOCUMENT ONLY; the caption teach
 * is the only future-facing lever. Guards: the right-click cleanup toolkit, `save-field-rule` and the
 * engine field_rules loop all refuse a list key; the hint writers skip a list field.
 *
 * Run: node src/windows/review/test_list_field_pills.js        (plain node — no Electron, no DB)
 */
const fs   = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const norm = (s) => s.replace(/\r\n/g, '\n');     // this checkout is core.autocrlf=true
const read = (...p) => norm(fs.readFileSync(path.join(REPO, ...p), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. listCaption.js — the JS twin of the collector's inline shape ─────────────────────────
console.log('\n1. shared/listCaption.js previewValues');
{
  const { previewValues } = require(path.join(REPO, 'src', 'windows', 'shared', 'listCaption.js'));
  check('tail bound: "Serial No" no longer fires on "Serial Nos: A" (the "s: A" debris pill)',
        eq(previewValues('Serial No', 'Serial Nos: A\nSerial No: NW-1\n'), ['NW-1']));
  check('tail bound is letter-only: a dotted caption ("Part No. 77") still matches',
        eq(previewValues('Part No', 'Part Nos: A\nPart No. 77\n'), ['77']));
  check('a caption glued to digits still collects ("Serial No1234")',
        eq(previewValues('Serial No', 'Serial No1234\n'), ['1234']));
  check('column break = 4+ spaces: the next column is cut',
        eq(previewValues('Serial No', 'Serial No: NW-1    Model X\n'), ['NW-1']));
  check('a 2-space gap INSIDE a value is kept (geometry text pads columns wider than that)',
        eq(previewValues('Serial No', 'Serial No: NW 1  X\n'), ['NW 1  X']));
  check('tab / middle-dot separators still cut',
        eq(previewValues('Serial No', 'Serial No: A1\tqty 2\nSerial No: B2 · qty 3\n'), ['A1', 'B2']));
  check('casefold dedupe, first-seen spelling kept',
        eq(previewValues('Serial No', 'Serial No: abc1\nSerial No: ABC1\nSerial No: abc2\n'), ['abc1', 'abc2']));
  check('a single-word caption stays word-bounded both sides ("Serials:" is not "Serial")',
        eq(previewValues('Serial', 'Serials: X\nSerial: Y\n'), ['Y']));
  check('no caption → nothing', eq(previewValues('', 'Serial No: X'), []));

  // ── Chris round 8 card 1: the caption the preview shows MUST be the caption the collector matches ──
  const { cleanCaption, isGenericCaption, extendCaption } = require(path.join(REPO, 'src', 'windows', 'shared', 'listCaption.js'));
  check('cleanCaption strips the trailing punctuation the IPC strips ("No:" → "No", "Serial No.  " → "Serial No")',
        cleanCaption('No:') === 'No' && cleanCaption('Serial No.  ') === 'Serial No' && cleanCaption('  Serial   No ') === 'Serial No');
  check('a bare tail is GENERIC (No / No. / Nos / Number / # / Ref / Date) — a phrase or a real caption is not',
        ['No', 'No.', 'Nos', 'Number', '#', 'Ref', 'Date', 'ID'].every(isGenericCaption)
        && !['Serial No', 'S/N', 'Model', 'Serial', 'Job Ref'].some(isGenericCaption));
  const page = 'JOB SHEET NO CJB-5054    DATE 20-03-2026    Job Ref JB-6875\nAlarm panel fitted  Serial No:    CT-8116138\nS/N: CT-8328847\nVAT Reg No GB 651 0027 84\n';
  check('a generic "No" beside a value on a "Serial No:" line extends to the phrase "Serial No" (shortest non-generic run)',
        extendCaption('No', 'CT-8116138', page) === 'Serial No');
  check('the drawn value decides the line — the same "No" beside the S/N value extends to "S/N"',
        extendCaption('No', 'CT-8328847', page) === 'S/N');
  check('a value the page does not show → null (the caller refuses; nothing is guessed)',
        extendCaption('No', 'ZZ-0000000', page) === null && extendCaption('No', '', page) === null);
  check('the sandbox exhibit: "No" would collect the job number AND the VAT number — the preview now shows that debris instead of hiding it behind "No:"',
        eq(previewValues(cleanCaption('No:'), page), ['CJB-5054', 'CT-8116138', 'GB 651 0027 84']));
}

// ── 2. review/renderer.js — the pills contract ───────────────────────────────────────────────
console.log('\n2. review/renderer.js');
{
  const R = read('src', 'windows', 'review', 'renderer.js');
  const slice = (from, to, span) => {
    const i = R.indexOf(from); if (i < 0) return '';
    const j = to ? R.indexOf(to, i + 1) : -1;
    return R.slice(i, j > 0 ? j : i + (span || 4000));
  };
  const menu = slice('function showFieldRuleMenu(', null, 900);
  check('right-click cleanup toolkit: a LIST key returns BEFORE e.preventDefault() (native menu stays)',
        menu.indexOf('_isListFieldKey(key)') > 0 && menu.indexOf('_isListFieldKey(key)') < menu.indexOf('e.preventDefault()'));

  const stage = slice('function _stageListCaption(', 'function _splitListValue(');
  check('⊕ caption teach writes through the store input event — never `corrections[...]` directly',
        stage.includes("dispatchEvent(new Event('input'") && !stage.includes('corrections[fieldKey] ='));
  check('the merge rule is current ∪ (preview − (original − current)) (Oracle cond 4)',
        stage.includes('_listUnion(current, _listMinus(preview, removed))') && stage.includes('_listMinus(original, current)'));
  check('the drawn value joins the preview ("+ One it missed" always lands what was pointed at)',
        /const drawn = String\(text \|\| ''\)\.trim\(\);/.test(stage) && stage.includes('_listUnion(vals, (drawn'));

  const row = slice('function appendFieldRow(', '\nfunction ');
  check('a list row renders the store input hidden + the pills + the tools strip',
        row.includes("list-store") && row.includes('class="list-chips"') && row.includes('class="list-tools"'));
  check('the store input listener repaints the pills on every write (the view never drifts from the store)',
        row.includes('if (_isList) _renderListChips(row);'));
  check('the list row is wired after the ⊕ handler', row.includes('if (_isList) _wireListRow(row, key);'));
  check('the ⊕ tooltip on a list row talks about the CAPTION, not a pinned position',
        /_pickTitle = _isList\s*\n?\s*\? 'Point to a value the list missed/.test(row));

  const chips = slice('function _renderListChips(', 'function _editListChip(');
  check('a removed entry stays visible with a put-back (a mis-click is one click to undo)',
        chips.includes("'list-chip removed'") && chips.includes("'list-chip-back'"));
  check('the receipt says "N found on this document" for a keyword_list read and never names an unverified caption',
        chips.includes('found on this document') && !chips.includes('under “'));
  const edit = slice('function _editListChip(', 'function _wireListRow(');
  check('a pill edit refuses the store separator ";" with a warning (collector parity) — without marking the store invalid (Chris r8 card 6: the red would spread to every pill)',
        edit.includes("nv.includes(';')") && edit.includes('setFieldWarning(row, null,') && !edit.includes('setFieldWarning(row, input,'));
  check('Enter commits, Escape cancels, blur commits', edit.includes("e.key === 'Enter'") && edit.includes("e.key === 'Escape'") && edit.includes("addEventListener('blur'"));
  const wire = slice('function _wireListRow(', '\n}\n');
  check('"+ One it missed" is the same door as ⊕', wire.includes("row.querySelector('.pick-btn')?.click()"));
  check('"Undo changes" restores data-original through the store input event',
        wire.includes('input.value = input.dataset.original;') && wire.includes("dispatchEvent(new Event('input'"));
  const setv = slice('function _setListValue(', 'function _listRowState(');
  check('every pill mutation goes through the store input event (the ONE corrections writer)',
        setv.includes("dispatchEvent(new Event('input'") && !setv.includes('corrections['));
}

// ── 3. review/index.html — state reaches the pills without JS sync ───────────────────────────
console.log('\n3. review/index.html');
{
  const H = read('src', 'windows', 'review', 'index.html');
  check('the store input is hidden in list mode, shown in "Edit as text" mode',
        H.includes('.field-input-wrap.list-mode .field-input.list-store { display: none; }')
        && H.includes('.field-input-wrap.list-mode.list-text-mode .field-input.list-store { display: block; }'));
  check('required-missing / invalid / low-conf / corrected / zone-active reach the pills via the sibling combinator',
        H.includes('.field-input.required-missing ~ .list-chips') && H.includes('.field-input.invalid ~ .list-chips')
        && H.includes('.field-input.corrected ~ .list-chips') && H.includes('.field-input.zone-active ~ .list-chips'));
  check('the pills have their own class family — not the search .as-chip', !/\.as-chip[^-]/.test(H.slice(H.indexOf('LIST field pills'))));
}

// ── 4. the guards behind the UI (server + engine + learning) ────────────────────────────────
console.log('\n4. save-field-rule / engine / learning guards');
{
  const P = read('src', 'modules', 'processing', 'handler.js');
  const i = P.indexOf("ipcMain.handle('save-field-rule'");
  const blk = P.slice(i, P.indexOf('learning.saveFieldRule(getDb()', i));
  check("save-field-rule refuses a LIST field by its TYPE (slug-keyed getWithFields) with { refused: 'list-field' }",
        blk.includes("getWithFields(getDb(), String(d.document_type))") && blk.includes("=== 'list'") && blk.includes("return { refused: 'list-field' }"));

  const RH = read('src', 'modules', 'review', 'handler.js');
  const ti = RH.indexOf("ipcMain.handle('teach-list-caption'");
  const tblk = RH.slice(ti, RH.indexOf('addLabelOverride(', ti));
  check('teach-list-caption normalises with the SHARED cleanCaption and refuses a generic tail server-side (no road can mint "No")',
        tblk.includes("require('../../windows/shared/listCaption.js')") && tblk.includes('LC.cleanCaption(label)')
        && tblk.includes('LC.isGenericCaption(cap)') && tblk.includes('generic: true'));

  const E = read('python_backend', 'extraction', 'engine.py');
  const fi = E.indexOf('if self.field_rules_index and document_slug:');
  const fblk = E.slice(fi, E.indexOf('apply_keep_block', fi));
  check('the engine field_rules loop skips a list key (Oracle cond 5 — the third guard)', fblk.includes("_list_field_keys"));

  const L = read('database', 'modules', 'learning.js');
  const sc = L.slice(L.indexOf('function saveCorrections('), L.indexOf('function _isListTypedField('));
  check('saveCorrections: a corrected LIST value is never a hint (per-document), scalar hints untouched',
        sc.includes('const _listKey = _isListTypedField(db, document_type, field_key);') && sc.includes('if (!_listKey) upsertHint.run(')
        && sc.includes('if (_isListTypedField(db, document_type, field_key)) continue;'));
  const rp = L.slice(L.indexOf('function replantConfirmHints('), L.indexOf('function replantConfirmHints(') + 3000);
  check('replantConfirmHints skips a list field in both loops', (rp.match(/_isListTypedField\(db, dt, /g) || []).length === 2);
  check('_isListTypedField is slug-keyed (the reviewService caller passes document_type_slug)',
        /LOWER\(dt\.slug\) = LOWER\(\?\) AND f\.key = \?/.test(L.slice(L.indexOf('function _isListTypedField('))));

  const K = read('python_backend', 'extraction', 'keyword.py');
  check('LIST_CAPTION_TAIL_BOUND + LIST_ELEMENT_DIGIT_GATE are their own env switches, default ON',
        K.includes("LIST_CAPTION_TAIL_BOUND  = os.environ.get('LIST_CAPTION_TAIL_BOUND', '1') != '0'")
        && K.includes("LIST_ELEMENT_DIGIT_GATE  = os.environ.get('LIST_ELEMENT_DIGIT_GATE', '1') != '0'"));
  check('the tail bound is applied ONLY under collect (scalar reads byte-identical)',
        K.includes('if collect and LIST_CAPTION_TAIL_BOUND:'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
