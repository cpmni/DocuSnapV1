'use strict';
/*
 * test_put_back_hold.js — Chris round 18 card A3 (2026-08-23): PUT BACK MUST STICK.
 *
 * THE INCIDENT: "Put back" on an activity chip de-confirmed 7 swept documents; 1.5 s after the user's
 * next confirm on that sender the scope auto-accept re-filed all 7 (and 9 Copperfield siblings the
 * moment a date was corrected) — recorded as confirmed by the user. The undo was illusory.
 *
 * Pins:
 *   • mig 86 adds documents.put_back_at (NULL-inert)
 *   • documents.markPutBack stamps a needs_review row; THE ONE predicate (trust.isAutoFileEligible)
 *     refuses a stamped row with reason 'put-back' at ANY confidence (100, user threshold 1) —
 *     positive control: the same row un-stamped is eligible
 *   • a human confirm clears the stamp at claim (confirmIfReviewable) — the next machine door sees a
 *     clean row
 *   • the readiness classifier never calls a put-back row 'ready' (File All / Home)
 *   • the class fix's candidate scan skips put-back siblings (source contract + live query)
 *   • both undo doors stamp what they de-confirm (source contract)
 *   • Review says why ('put-back' kind renders its own calm lead)
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_put_back_hold.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const trust = require('./trust');
const learning = require('./learning');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR + LF).join(LF);

const db = new Database(':memory:');
runMigrations(db);
console.log('migration 86:');
check('documents.put_back_at exists after migrations', !!db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='put_back_at'").get());
check('version 86 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 86').get());

db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req] of [['supplier_name', 1], ['invoice_number', 1], ['invoice_date', 1]])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, 'text', ?, 1, 1)").run(k, k, req);
learning.setSetting(db, 'auto_file_threshold', '1');          // the laxest slider: only the stamp can refuse
const mk = (oc = 100, status = 'needs_review') => {
  const id = Number(documents.insert(db, { original_filename: `d${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status, supplier_name: 'Acme Widgets', document_type_id: 1 }).lastInsertRowid);
  db.prepare('UPDATE documents SET overall_confidence = ? WHERE id = ?').run(oc, id);
  for (const [k, v] of [['supplier_name', 'Acme Widgets'], ['invoice_number', 'INV-100'], ['invoice_date', '01-08-2026']])
    db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 99, 'keyword')").run(id, k, v, v);
  return id;
};
const row = (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

console.log('\nthe predicate:');
const A = mk(100);
check('positive control: an un-stamped 100 % row is eligible', trust.isAutoFileEligible(db, row(A)).eligible === true);
check('markPutBack stamps a needs_review row', documents.markPutBack(db, A).changes === 1 && !!row(A).put_back_at);
const rA = trust.isAutoFileEligible(db, row(A));
check("…and the predicate refuses it with reason 'put-back' at 100 % / slider 1 (unconditional)", rA.eligible === false && rA.reason === 'put-back');
check('autoFileEligibleIds (the sweep\'s batch door) drops it too', !trust.autoFileEligibleIds(db, [row(A)]).includes(A));
const C = mk(100, 'confirmed');
check('markPutBack does nothing to a row that is not in the queue', documents.markPutBack(db, C).changes === 0);
check("a doc object WITHOUT the field (an import-time message) is judged as before", trust.isAutoFileEligible(db, { ...row(A), put_back_at: undefined }).eligible === true);

console.log('\nthe human confirm clears it:');
const claim = documents.confirmIfReviewable(db, A, { stored_filename: 'x.pdf', stored_path: '/out/x.pdf', confirmed_by_username: 'chris' });
check('confirmIfReviewable claims the put-back row', claim.changes === 1 && row(A).status === 'confirmed');
check('…and clears put_back_at at claim time', row(A).put_back_at == null);
documents.deconfirmDocument(db, A);
check('deconfirmDocument itself STAMPS (Oracle W/COND: Search / Repair send-back notes are not durable — every human "look again" door holds)', row(A).status === 'needs_review' && !!row(A).put_back_at);
const M = mk(100, 'confirmed'); documents.deconfirmDocument(db, M);
const mclaim = documents.confirmIfReviewable(db, M, { stored_filename: 'm.pdf', stored_path: '/out/m.pdf', confirmed_by_username: 'Auto-filed (x)', confirmed_via: 'scope_sweep' });
check('a MACHINE claim (confirmed_via set) does NOT clear the stamp — only a human claim does', mclaim.changes === 1 && !!row(M).put_back_at);
db.prepare("UPDATE documents SET status = 'confirmed' WHERE id = ?").run(A);
const R = { sn: 'Acme Widgets', slug: 'invoice' };
documents.requeueConfirmedDocsForScope(db, { supplier_name: R.sn, document_type_slug: R.slug });
check('requeueConfirmedDocsForScope stamps every row it returns to the queue', db.prepare("SELECT COUNT(*) c FROM documents WHERE status='needs_review' AND supplier_name='Acme Widgets' AND put_back_at IS NULL").get().c === 0);

console.log('\nthe classifier (File All / Home):');
const RR = require('../../src/windows/shared/reviewReadiness.js') && globalThis.ReviewReadiness;
const B = mk(100); documents.markPutBack(db, B);
const Dc = mk(100);                                               // a clean, never-returned row
const q = Object.fromEntries(documents.getReviewQueue(db).map(d => [d.id, d]));
check('getReviewQueue rows carry put_back_at', q[B] && !!q[B].put_back_at && q[Dc] && q[Dc].put_back_at == null);
check("a put-back row classifies as 'flagged' (never 'ready'); the clean row stays 'ready'", RR.classify(q[B]) === 'flagged' && RR.classify(q[Dc]) === 'ready');

console.log('\nthe class fix skips put-back siblings:');
const cfs = read(path.join(__dirname, '..', '..', 'src', 'services', 'classFixService.js'));
check('candidate scan excludes d.put_back_at IS NOT NULL (column-guarded)', /AND \(@hasPutBack = 0 OR d\.put_back_at IS NULL\)/.test(cfs) && /_hasPutBackAt\(db\) \? 1 : 0/.test(cfs));

console.log('\nthe undo doors stamp (source contract):');
const ph = read(path.join(__dirname, '..', '..', 'src', 'modules', 'processing', 'handler.js'));
const undoA = ph.slice(ph.indexOf("ipcMain.handle('review-event-undo'"), ph.indexOf("ipcMain.handle('get-quiet-reread-status'"));
const undoB = ph.slice(ph.indexOf("ipcMain.handle('sweep-scope-undo'"), ph.indexOf("ipcMain.handle('sweep-scope-undo'") + 2500);
check('review-event-undo marks every de-confirmed doc put back', /undone\.push\(id\); try \{ documents\.markPutBack\(db, id\); \} catch \{\}/.test(undoA));
check('sweep-scope-undo marks every de-confirmed doc put back', /undone\.push\(id\); try \{ documents\.markPutBack\(db, id\); \} catch \{\}/.test(undoB));
check('the Tier-2 synth row carries put_back_at (the stamp reaches the predicate there too)', /put_back_at: doc\.put_back_at \|\| null,/.test(ph));
check("the AUTO accept files under a machine name, never the triggering person", /username: 'Auto-filed \(after your confirms\)'/.test(ph) && /actor: _autoActor, auto: true/.test(ph));
const rs = read(path.join(__dirname, '..', '..', 'src', 'services', 'reviewService.js'));
check('reviewService refuses a MACHINE via on a stamped doc pre-claim (PUT_BACK, audited)', /if \(_via\) \{[\s\S]{0,900}return fail\('PUT_BACK'/.test(rs) && /confirm_refused_put_back/.test(rs));
check('…and the claim clears the stamp only when confirmed_via is NULL', /_hasPutBackAt\(db\) && !confirmed_via \?/.test(read(path.join(__dirname, 'documents.js'))));

console.log('\nReview says why:');
const rend = read(path.join(__dirname, '..', '..', 'src', 'windows', 'review', 'renderer.js'));
check("renderCleanHoldReason renders the 'put-back' kind with its own lead", /v\.kind === 'put-back'/.test(rend) && /You put this document back — it won't file itself until you confirm it\./.test(rend));
const tr = read(path.join(__dirname, 'trust.js'));
check('the refusal sits BEFORE the floor logic (unconditional — any confidence, any graduation)', tr.indexOf("reason: 'put-back'") < tr.indexOf("const floor = (graduated || corroborated)"));

// ── mig 87: PUT-BACK RE-FILE via File All Ready (2026-08-23, Oracle SIGN-OFF-W/COND) ──────────────
console.log('\nmig 87 columns:');
check('documents.refile_declined_at + putback_refiled_at exist', !!db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='refile_declined_at'").get() && !!db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='putback_refiled_at'").get());
check('version 87 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 87').get());
const qmap = () => Object.fromEntries(documents.getReviewQueue(db).map(d => [d.id, d]));

console.log('\nOFF is byte-identical (the switch defaults off):');
const P = mk(100); documents.markPutBack(db, P);
let Q = qmap();
check('OFF: a clean put-back doc is NOT stamped refileable → classify flagged (held, exactly mig 86)', !Q[P].putback_refileable && RR.classify(Q[P]) === 'flagged');
check('OFF: the bypass predicate is not consulted — a machine read still refuses put-back', trust.isAutoFileEligible(db, row(P)).reason === 'put-back');

console.log('\nswitch ON — the explicit File-All population widens, machine paths do not:');
learning.setSetting(db, 'putback_refile_on_file_all', 'true');
Q = qmap();
check('ON: a clean put-back doc is stamped refileable → classify ready', Q[P].putback_refileable === 1 && RR.classify(Q[P]) === 'ready');
check('bypass containment: isAutoFileEligible WITH bypassPutBack = eligible; WITHOUT = put-back', trust.isAutoFileEligible(db, row(P), { bypassPutBack: true }).eligible === true && trust.isAutoFileEligible(db, row(P)).reason === 'put-back');
check('machine batch door (no bypass) STILL drops the put-back doc (the bypass never leaks to machine paths)', !trust.autoFileEligibleIds(db, [row(P)]).includes(P));

console.log('\nthe danger pin — a doc that would never auto-file stays held even ON:');
const F = mk(100);
db.prepare("UPDATE extractions SET validation_note = 'check this' WHERE document_id = ? AND field_key = 'invoice_number'").run(F);
documents.markPutBack(db, F);
const QF = qmap();
check('a flagged (never-eligible) put-back doc is NOT refileable → held even with the switch on', !QF[F].putback_refileable && RR.classify(QF[F]) === 'flagged');
check('…because the bypass predicate still refuses it (flagged runs AFTER the put-back bypass)', trust.isAutoFileEligible(db, row(F), { bypassPutBack: true }).eligible === false);

console.log('\nthe re-file records history; the undo loop hard-holds (Oracle BLOCKING cond 2):');
const claimP = documents.confirmIfReviewable(db, P, { stored_filename: 'p.pdf', stored_path: '/out/p.pdf', confirmed_by_username: 'chris' });
check('File-All re-file (human confirm) clears put_back_at AND records putback_refiled_at', claimP.changes === 1 && row(P).status === 'confirmed' && row(P).put_back_at == null && !!row(P).putback_refiled_at);
documents.deconfirmDocument(db, P);
check('pulling the re-filed doc BACK again sets refile_declined_at (the reversal is the strongest signal)', !!row(P).refile_declined_at && !!row(P).put_back_at);
const rP = trust.isAutoFileEligible(db, row(P), { bypassPutBack: true });
check("…and the bypass can NEVER resurrect it (reason 'refile-declined')", rP.eligible === false && rP.reason === 'refile-declined');
const QP2 = qmap();
check('…so it is not refileable → a SECOND File All will NOT re-file it', !QP2[P].putback_refileable && RR.classify(QP2[P]) === 'flagged');
const claimP2 = documents.confirmIfReviewable(db, P, { stored_filename: 'p2.pdf', stored_path: '/out/p2.pdf', confirmed_by_username: 'chris' });
check('ONLY a per-doc human confirm clears the hard-hold (refile_declined_at + put_back_at both null)', claimP2.changes === 1 && row(P).refile_declined_at == null && row(P).put_back_at == null && row(P).status === 'confirmed');

console.log('\nthe refusal order (refile-declined before put-back, both before the floor):');
check('trust.js refuses refile-declined BEFORE put-back, and put-back before the floor', (() => {
  const tr2 = read(path.join(__dirname, 'trust.js'));
  return tr2.indexOf("reason: 'refile-declined'") < tr2.indexOf("reason: 'put-back'")
      && tr2.indexOf("reason: 'put-back'") < tr2.indexOf('const floor = (graduated || corroborated)');
})());
check('the put-back refusal is bypassable ONLY via opts.bypassPutBack (source contract)', /doc\.put_back_at && !opts\.bypassPutBack/.test(read(path.join(__dirname, 'trust.js'))));

learning.setSetting(db, 'putback_refile_on_file_all', 'false');   // leave the fixture switch off

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
