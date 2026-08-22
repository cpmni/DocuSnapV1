'use strict';
/*
 * test_teach_speaks.js — PINs for "the teach speaks" (Chris rounds 3 + 4, Oracle B8).
 *
 * THE DEFECT. Four review rounds running, Chris reported the same thing: "four draws, four
 * silences, including a near-perfect read." In round 4 it cost twelve filed files — a box that
 * read `B8ramblewood Joinery Ltd` said nothing at the draw, nothing at confirm, and the garble
 * reached 20 documents and a misspelled output folder. The practice run answers every draw with
 * `Read "INV-1042" from your box.`; the real teach had never said it once.
 *
 * TWO KINDS OF CHECK, deliberately:
 *   1. BEHAVIOURAL — `learning.findNearMatchIdentity` against a real better-sqlite3 database,
 *      because the sentence the operator reads is only as good as the lookup behind it, and the
 *      machine-confirm exclusion is the part that is easy to regress silently.
 *   2. STRUCTURAL — the renderer sources, because the speaking paths are DOM-bound and the thing
 *      being pinned is that no branch is left silent (the empty read, the anchor-less read, the
 *      thrown read) and that a warning is not erased by a cheerful message in the same tick.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/windows/review/test_teach_speaks.js
 */
const path = require('path');
const fs   = require('fs');
const Database = require(path.join('c:', 'GIT Projects', 'Docusnap', 'node_modules', 'better-sqlite3'));

const REPO = path.resolve(__dirname, '..', '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const { MACHINE_VIAS } = require(path.join(REPO, 'database', 'modules', 'machine_vias.js'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

// ── 1. the lookup behind the sentence ────────────────────────────────────────────────────────
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_filename TEXT, status TEXT, supplier_name TEXT, confirmed_via TEXT
    );
  `);
  return db;
}
const addDocs = (db, name, n, via = null) => {
  const ins = db.prepare("INSERT INTO documents (original_filename, status, supplier_name, confirmed_via) VALUES (?, 'confirmed', ?, ?)");
  for (let i = 0; i < n; i++) ins.run(`d${i}.pdf`, name, via);
};

console.log('1. findNearMatchIdentity — the substrate and the verdict');
{
  const db = freshDb();
  addDocs(db, 'Bramblewood Joinery Ltd', 38);
  const v = learning.findNearMatchIdentity(db, 'B8ramblewood Joinery Ltd');
  check('the round-4 exhibit is caught as a near match', v.near === true);
  check('it names the incumbent the customer already files under', v.existing === 'Bramblewood Joinery Ltd');
  check('it carries the confirm COUNT, so the sentence can say "38 documents"', v.confirms === 38);
  check('one edit is reported as distance 1', v.distance === 1);

  // THE INVARIANT: a genuinely different company must NOT be offered as "the same, misread" —
  // else re-teaching could never correct a wrong stored name. 3 edits, similarity 0.864.
  const diff = learning.findNearMatchIdentity(db, 'Brambleworth Joinery Ltd');
  check('a genuinely DIFFERENT company is not a near match', diff.near === false);

  check('the exact same name is not reported as a near match', learning.findNearMatchIdentity(db, 'Bramblewood Joinery Ltd').near === false);
  check('an empty value is not judged', learning.findNearMatchIdentity(db, '  ').near === false);
  db.close();
}
{
  // MACHINE CONFIRMS ARE NOT "a name you already use" — the exhibit's own 20 poisoned documents
  // were machine-stamped at 95, and offering that cohort back as the known name would close the
  // loop the arc exists to break.
  const db = freshDb();
  for (const via of MACHINE_VIAS) addDocs(db, 'Bramblewood Joinery Ltd', 10, via);
  check('a machine-confirmed cohort is never the suggested target',
        learning.findNearMatchIdentity(db, 'B8ramblewood Joinery Ltd').near === false);
  addDocs(db, 'Bramblewood Joinery Ltd', 3);            // three HUMAN confirms
  check('three human confirms of the same name DO make it a target',
        learning.findNearMatchIdentity(db, 'B8ramblewood Joinery Ltd').near === true);
  db.close();
}
{
  const db = freshDb();
  addDocs(db, 'Bramblewood Joinery Ltd', 2);            // below the default floor
  check('fewer than 3 confirms is not enough to become the suggested target',
        learning.findNearMatchIdentity(db, 'B8ramblewood Joinery Ltd').near === false);
  db.close();
}
{
  // Older DBs / fixtures predate confirmed_via (migration 57): the query must degrade, not throw.
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, supplier_name TEXT)`);
  const ins = db.prepare("INSERT INTO documents (status, supplier_name) VALUES ('confirmed', ?)");
  for (let i = 0; i < 5; i++) ins.run('Bramblewood Joinery Ltd');
  check('a pre-migration-57 DB (no confirmed_via) still answers instead of throwing',
        learning.findNearMatchIdentity(db, 'B8ramblewood Joinery Ltd').near === true);
  db.close();
}
{
  const db = new Database(':memory:');           // no documents table at all
  check('a missing table returns "not near" rather than breaking the teach',
        learning.findNearMatchIdentity(db, 'Anything Ltd').near === false);
  db.close();
}
{
  // TIER B — frozen template identity (Chris round 5, card 3). A FRESH install has ZERO confirmed
  // docs, so Tier A finds nothing; the correct spelling lives only on the sender's own taught
  // layout. Tier B must surface it as an ASK-only source so the challenge fires from document one.
  const db = freshDb();
  db.exec(`CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
           CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER,
             field_key TEXT, fixed_value TEXT, is_variable INTEGER DEFAULT 1);`);
  db.prepare("INSERT INTO templates (id, name, slug) VALUES (1, 'Bramblewood PO', 'bramblewood-po')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (1,'supplier_name','Bramblewood Joinery Ltd',0)").run();
  const b = learning.findNearMatchIdentity(db, 'Drambiewood Joinery Ltd');
  check('Tier B fires with NO confirmed docs (the fresh-install case that was silent)', b.near === true);
  check('  → it names the frozen correct spelling', b.existing === 'Bramblewood Joinery Ltd');
  check('  → it is labelled source:template so the sentence never says "on null documents"', b.source === 'template');
  check('a genuinely different company still is not a near match under Tier B',
        learning.findNearMatchIdentity(db, 'Zenith Logistics PLC').near === false);
  check('re-teaching the exact frozen value raises no needless ASK',
        learning.findNearMatchIdentity(db, 'Bramblewood Joinery Ltd').near === false);
  // A VARIABLE (non-frozen) identity field is NOT a Tier-B source — only frozen identities are.
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (2,'supplier_name','Silverbeck Supplies Ltd',1)").run();
  check('a NON-frozen (is_variable=1) identity is not a Tier-B source',
        learning.findNearMatchIdentity(db, 'Silverbeck Suplies Ltd').near === false);
  // Tier A OUTRANKS Tier B: 3 human confirms of a name win over any frozen value.
  addDocs(db, 'Northgate Motors Ltd', 3);
  const a = learning.findNearMatchIdentity(db, 'Northgate Motprs Ltd');
  check('Tier A (human confirms) outranks Tier B and is labelled source:confirms',
        a.near === true && a.source === 'confirms' && a.confirms === 3);
  db.close();
}

// ── 2. no teach path is left silent ──────────────────────────────────────────────────────────
console.log('\n2. every outcome of a draw says something (review/renderer.js)');
const rend = read('src/windows/review/renderer.js');

check('the EMPTY read has an else branch that speaks (it produced nothing at all before)',
      /I couldn't read any text in that box/.test(rend));
check('a THROWN read speaks too, instead of only console.error',
      /Something went wrong reading that box/.test(rend));
check('a read with no anchor context speaks (previously silent inside if (detected))',
      /I read <span class="ar-val">\$\{escHtml\(text\)\}<\/span> from your box, and I'll/.test(rend));
check('the issuer read-back goes through one shared speaker',
      /await speakIssuerTeach\(fieldKey, text\)/.test(rend));
check('the issuer branch no longer congratulates via a toast',
      !/Captured the ' \+ \(labelFor\(fieldKey\) \|\| 'company name'\)/.test(rend));
check('the message lands on the PERSISTENT #anchor-readout bar, not a toast',
      /function showTeachMessage\(/.test(rend)
      && /function showTeachMessage\([\s\S]{0,200}getElementById\('anchor-readout'\)/.test(rend));
check('a warning that needs a DECISION does not time out',
      /if \(!warn\) _anchorReadoutTimer = setTimeout\(hideAnchorReadout/.test(rend));

console.log('\n3. the near-match challenge, and what it may not do');
check('the renderer asks the shared near-match predicate',
      /checkIdentityNearMatch\(text\)/.test(rend));
check('it offers the incumbent as a one-click choice',
      /Use "\$\{nm\.existing\}"/.test(rend) || /Use "\$\{escHtml\(nm\.existing\)\}"/.test(rend));
check('it also offers KEEP — a different company must stay teachable',
      /Keep what I read/.test(rend));
check('choosing the incumbent goes through the correction path, not a synthetic input event',
      /_applyTeachValue\(fieldKey, nm\.existing\)/.test(rend)
      && /corrections\[fieldKey\] = \{ original_value: orig, corrected_value: value \}/.test(rend));

console.log('\n4. a warning is not erased by a cheerful message in the same tick');
check('showToast carries a sticky LEVEL guard',
      /_TOAST_RANK/.test(rend) && /if \(live && \(_TOAST_RANK\[level\] \?\? 0\) < \(_TOAST_RANK\[_toastLevel\] \?\? 0\)\) return;/.test(rend));
check('and it is a level guard, NOT a toast queue (Oracle: a queue shows the warning too late)',
      !/toastQueue|_toastQueue|queue\.push\(.*toast/i.test(rend));

console.log('\n5. the wizard asks BEFORE the irreversible step');
const teach = read('src/windows/teach/renderer.js');
// Strip line comments before asserting an ABSENCE: the defect is deliberately DESCRIBED in the
// comments that replaced it, and a pin a comment can break is a pin someone "fixes" by deleting
// the explanation.
const teachCode = teach.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check('the confirm panel asks for the verdict while it is still on screen',
      /if \(issuer\) _warnOnIssuerValue\(f, r\)/.test(teachCode));
check('finishIssuerField no longer maps a FAILED check to the success message',
      !/\.catch\(_ok\)/.test(teachCode));
check('finishIssuerField now names the captured value',
      /Captured "\$\{r\.value\}" as the \$\{f\.label\}/.test(teach));
check('the wizard warning offers the known name too',
      /rb-use-known/.test(teach));
check('a stale answer is dropped if the operator moved on',
      /if \(curField\(\) !== f \|\| String\(\(state\.results\[f\.key\]\|\|\{\}\)\.value\|\|''\)\.trim\(\) !== v\) return;/.test(teach));

console.log('\n6. confirm and File All Ready say what happened');
check('confirm names the filed document, and the folder it landed in',
      /showToast\(_dir \? `Filed as \$\{_fn\} in \$\{_dir\}\.`/.test(rend));
check('the destination is built from the returned filingResult, not re-derived',
      /result\.filename \|\| ''/.test(rend) && /_filedFolderLabel\(result\.filePath, _fn\)/.test(rend));
check('the folder label is the last few SEGMENTS, never the absolute path (de-pathing)',
      /parts\.slice\(-3\)\.join\(' \/ '\)/.test(rend));
check('bulk stays silent per-document (File All Ready reports once at the end)',
      /if \(!bulk\) \{[\s\S]{0,400}Filed as/.test(rend));
check('File All Ready puts a COUNT in its warning — the number that files, not "up to" (Chris r12 #5)',
      /File \$\{_eligible\} ready document/.test(rend) && !/File up to \$\{_eligible\}/.test(rend));
// Q4b (2026-08-22): the three skip reasons now come from THE ONE classifier
// (shared/reviewReadiness.js — flagged › noType › missing) that Home's split uses too; the loop's
// own flag skip is unchanged.
check('...computed with the loop\'s OWN THREE skip reasons (flag · no type · missing required) via the shared '
      + 'classifier, so the dialog cannot promise a different population (nor can Home)',
      /const _parts\s+= window\.ReviewReadiness\.partition\(docs, \{ valuedOnly: !!window\.__farValuedOnly \}\);/.test(rend)
      && /const _flagged\s+= _parts\.flagged;/.test(rend) && /const _noType\s+= _parts\.noType;/.test(rend)
      && /const _missing\s+= _parts\.missing;/.test(rend) && /const _eligible\s+= _parts\.ready\.length;/.test(rend)
      && /if \(isFlagged\(doc\) && !doc\.review_acknowledged_at\) \{ skipped\+\+; continue; \}/.test(rend));
check('...and names each held group in the dialog', /with no document type yet/.test(rend) && /missing a required detail/.test(rend));
check('...and refuses early, with a reason, when nothing is eligible',
      /Nothing is ready to file yet/.test(rend));
check('the run leaves a summary that outlives the 4s toast, naming the senders',
      /Filed \$\{filed\} document\$\{filed === 1 \? '' : 's'\}`[\s\S]{0,200}_list/.test(rend));

console.log('\n7. the issuer clear names what it emptied and offers the way back');
check('the clear collects the values it removes (so undo is possible)',
      /cleared\.push\(\{ key, label: labelFor\(key\) \|\| key, value: input\.value \}\)/.test(rend));
check('it names the fields rather than only counting them',
      /const names = cleared\.map\(c => `<strong>\$\{escHtml\(c\.label\)\}<\/strong>`\)/.test(rend));
check('it offers an undo that also releases the render suppression',
      /Undo — put them back/.test(rend) && /clearedByIssuerChange\.delete\(c\.key\)/.test(rend));
check('it APPENDS to the bar, so the read-back that caused it is not erased',
      /appendTeachMessage\(/.test(rend) && /function appendTeachMessage\(/.test(rend));

console.log('\n8. wiring');
check('preload exposes the near-match check', /checkIdentityNearMatch:/.test(read('src/preload.js')));
check('the IPC is registered and login-gated',
      /ipcMain\.handle\('check-identity-near-match'/.test(read('src/modules/review/handler.js')));
check('a lookup failure returns "not near" so it can never block a teach',
      /return \{ near: false, reason: 'error' \};/.test(read('src/modules/review/handler.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
