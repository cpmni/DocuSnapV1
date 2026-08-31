/** test_corrob_autofile.js — the corroborated auto-file route (owner order 2026-08-11,
 *  Oracle SIGN-OFF-W/COND; C1 volume-only substitution + C2 window exclusion pinned here).
 *
 *  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_corrob_autofile.js
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const trust = require('./trust');
const documents = require('./documents');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT,
      type TEXT, required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, document_type_id INTEGER, status TEXT,
      supplier_name TEXT, overall_confidence INTEGER, confirmed_at TEXT, confirmed_via TEXT,
      confirmed_by_username TEXT, stored_filename TEXT, stored_path TEXT, supplier_pin TEXT,
      template_id INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
      raw_value TEXT, display_value TEXT, confidence INTEGER, validation_note TEXT,
      corrected_to TEXT, extraction_method TEXT, corroboration TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
      original_value TEXT, corrected_value TEXT);
    CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, document_type_slug TEXT,
      supplier_name TEXT);
  `);
  db.prepare("INSERT INTO document_types (id, name, slug, ref_field_key, date_field_key) VALUES (1, 'Service Worksheet', 'service_worksheet', 'worksheet_number', 'worksheet_date')").run();
  for (const [k, ty, req] of [['supplier_name', 'text', 1], ['worksheet_number', 'reference_code', 1], ['worksheet_date', 'date', 1]]) {
    db.prepare('INSERT INTO fields (document_type_id, key, type, required) VALUES (1, ?, ?, ?)').run(k, ty, req);
  }
  db.prepare("INSERT INTO templates (id, name, document_type_slug, supplier_name) VALUES (7, 'Acme', 'service_worksheet', 'Acme Ltd')").run();
  return db;
}

const LIC = JSON.stringify({ winner_family: 'mapping', agree: ['keyword'], disagree: [], independent_agree: true });
const MEMHINT = JSON.stringify({ winner_family: 'memory', agree: ['hint'], disagree: [], independent_agree: true });
const DISAGREE = JSON.stringify({ winner_family: 'mapping', agree: ['keyword'], disagree: [{ family: 'hint', value: 'X' }], independent_agree: true });

// n human confirms + optional machine rows; docId auto-increments from 100
let nextId = 100;
function addConfirmed(db, n, { via = null, at = '2026-08-01T10:00:00' } = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    db.prepare(`INSERT INTO documents (id, document_type_id, status, supplier_name, overall_confidence, confirmed_at, confirmed_via)
                VALUES (?, 1, 'confirmed', 'Acme Ltd', 100, ?, ?)`).run(id, at + '.' + String(i).padStart(3, '0'), via);
    ids.push(id);
  }
  return ids;
}

// the candidate doc: conf 95, unflagged, corroboration per-field
function addCandidate(db, { corrobs = {}, conf = 95, refConf = 98 } = {}) {
  const id = nextId++;
  db.prepare(`INSERT INTO documents (id, document_type_id, status, supplier_name, overall_confidence, template_id)
              VALUES (?, 1, 'needs_review', 'Acme Ltd', ?, 7)`).run(id, conf);
  // `in` check, not `??` — a test passing an explicit null (the pre-mig-63 row) must land as
  // NULL in the column, not silently fall back to the licensed default.
  const pick = (k) => (k in corrobs ? corrobs[k] : LIC);
  const rows = [
    ['supplier_name', 'Acme Ltd', 95, pick('supplier_name')],
    ['worksheet_number', 'CJB-1234', refConf, pick('worksheet_number')],
    ['worksheet_date', '26-09-2025', 98, pick('worksheet_date')],
  ];
  for (const [k, v, c, cb] of rows) {
    db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, corroboration)
                VALUES (?, ?, ?, ?, ?, 'template_mapping', ?)`).run(id, k, v, v, c, cb);
  }
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

// docTrustGate needs learned formats; give the scope a verifiable non-freetext history via opts.formats
const FORMATS = [
  { supplier_name: 'acme ltd', document_type: 'service_worksheet', field_key: 'worksheet_number',
    sample_values: ['CJB-1111', 'CJB-2222', 'CJB-3333', 'CJB-4444', 'CJB-5555'], confirmed_count: 5 },
  { supplier_name: 'acme ltd', document_type: 'service_worksheet', field_key: 'worksheet_date',
    sample_values: ['01-01-2025', '02-02-2025', '03-03-2025', '04-04-2025', '05-05-2025'], confirmed_count: 5 },
  { supplier_name: 'acme ltd', document_type: 'service_worksheet', field_key: 'supplier_name',
    sample_values: ['Acme Ltd', 'Acme Ltd', 'Acme Ltd', 'Acme Ltd', 'Acme Ltd'], confirmed_count: 5 },
];
const OPTS = { formats: FORMATS, requireTemplate: false };

function elig(db, doc, extra = {}) {
  return trust.isAutoFileEligible(db, doc, { ...OPTS, corrobAutoFile: true, ...extra });
}

function main() {
  delete process.env.CORROB_AUTOFILE;

  // 1. default OFF → below-floor (byte-identical pin)
  let db = freshDb(); nextId = 100;
  addConfirmed(db, 5);
  let doc = addCandidate(db);
  let r = trust.isAutoFileEligible(db, doc, OPTS);
  check('1. flag OFF → below-floor (route never consulted)', !r.eligible && r.reason === 'below-floor');

  // 2. ON → fully-corroborated 95 doc on a clean volume-short scope files at floor 95
  r = elig(db, doc);
  check('2. ON → eligible at floor 95, basis corroborated',
    r.eligible && r.floor === 95 && r.basis === 'corroborated');

  // 3. memory+hint on the issuer → NOT eligible (THE pinned trade-off — no future dev "fixes
  //    Castellan" by restoring the circular pair; its refusal is load-bearing for the DAY2
  //    young-identity guard too)
  doc = addCandidate(db, { corrobs: { supplier_name: MEMHINT } });
  r = elig(db, doc);
  check('3. memory+hint issuer → below-floor (near-circular pair never licenses)',
    !r.eligible && r.reason === 'below-floor');

  // 4. any validation_note anywhere → flagged despite full corroboration
  doc = addCandidate(db);
  db.prepare("UPDATE extractions SET validation_note = 'doesn''t read like a name' WHERE document_id = ? AND field_key = 'supplier_name'").run(doc.id);
  r = elig(db, doc);
  check('4. wordness note → flagged (corroboration cannot bypass the flag block)', !r.eligible && r.reason === 'flagged');

  // 5. role-field disagree non-empty → declined
  doc = addCandidate(db, { corrobs: { worksheet_number: DISAGREE } });
  r = elig(db, doc);
  check('5. independent disagree on the ref role → declined', !r.eligible && r.reason === 'below-floor');

  // 6. NULL / malformed record → declined, no throw
  doc = addCandidate(db, { corrobs: { worksheet_date: null } });
  check('6a. NULL record → declined (pre-mig-63 rows inert)', !elig(db, doc).eligible);
  doc = addCandidate(db, { corrobs: { worksheet_date: '{not json' } });
  check('6b. malformed record → declined, no throw', !elig(db, doc).eligible);

  // 7. empty role value → declined
  doc = addCandidate(db);
  db.prepare("UPDATE extractions SET raw_value = '', display_value = '' WHERE document_id = ? AND field_key = 'worksheet_number'").run(doc.id);
  check('7. empty ref value → declined (stricter than graduation)', !elig(db, doc).eligible);

  // 8. a correction in scope → declined (volume-only substitution — Oracle C1)
  db = freshDb(); nextId = 100;
  const ids = addConfirmed(db, 8);
  db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value) VALUES (?, 'worksheet_number', 'A', 'B')").run(ids[0]);
  doc = addCandidate(db);
  r = elig(db, doc);
  check('8. 8 confirms + 1 correction → declined (corroboration never bridges a dirty scope)',
    !r.eligible && r.reason === 'below-floor');

  // 8b. C1: machine confirms count toward DIRT, never toward volume
  db = freshDb(); nextId = 100;
  addConfirmed(db, 5);
  const mids = addConfirmed(db, 2, { via: 'auto_corroborated' });
  db.prepare("INSERT INTO corrections (document_id, field_key, original_value, corrected_value) VALUES (?, 'worksheet_number', 'A', 'B')").run(mids[0]);
  doc = addCandidate(db);
  check('8b. a correction on a MACHINE-filed doc also declines the route', !elig(db, doc).eligible);

  // 9. <3 human confirms → declined (cold scope can never corroborate-file)
  db = freshDb(); nextId = 100;
  addConfirmed(db, 2);
  doc = addCandidate(db);
  check('9. 2 confirms → declined (>=3 human floor)', !elig(db, doc).eligible);

  // 9b. machine confirms do not satisfy the >=3 floor
  db = freshDb(); nextId = 100;
  addConfirmed(db, 2);
  addConfirmed(db, 5, { via: 'auto_corroborated' });
  doc = addCandidate(db);
  check('9b. 2 human + 5 machine → still declined (C2: machine files never volume)', !elig(db, doc).eligible);

  // 10. ref conf below the 88 critical floor → weak-critical-field (comparator untouched)
  db = freshDb(); nextId = 100;
  addConfirmed(db, 5);
  doc = addCandidate(db, { refConf: 87 });
  r = elig(db, doc);
  check('10. corroborated but ref conf 87 → weak-critical-field', !r.eligible && /weak-critical-field/.test(r.reason));
  doc = addCandidate(db, { refConf: 88 });
  check('10b. ref conf 88 passes BY DESIGN (do not "fix" the comparator)', elig(db, doc).eligible);

  // 11. graduation master switch off / per-scope opt-out → route refused
  doc = addCandidate(db);
  check('11a. gradOn=false refuses the route', !elig(db, doc, { gradOn: false }).eligible);
  check('11b. per-scope opt-out refuses the route', !elig(db, doc, { optOut: ['acme ltd|service_worksheet'] }).eligible);

  // 12. floor never below min(userThr, 95) across thresholds
  for (const thr of [90, 95, 100]) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_file_threshold', ?)").run(String(thr));
    const d2 = addCandidate(db);
    const rr = elig(db, d2);
    const observed = rr.floor;
    check(`12. userThr ${thr} → floor ${observed} >= min(thr,95)`, observed >= Math.min(thr, 95));
  }
  db.prepare("DELETE FROM settings WHERE key = 'auto_file_threshold'").run();

  // 13. env kill both directions (harness arms)
  process.env.CORROB_AUTOFILE = '0';
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('corroboration_autofile', 'true')").run();
  doc = addCandidate(db);
  check('13a. env 0 beats setting true', !trust.isAutoFileEligible(db, doc, OPTS).eligible);
  process.env.CORROB_AUTOFILE = '1';
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('corroboration_autofile', 'false')").run();
  check('13b. env 1 beats setting false', trust.isAutoFileEligible(db, doc, OPTS).eligible);
  delete process.env.CORROB_AUTOFILE;

  // 14. graduated scope unaffected: basis 'graduated', not 'corroborated'
  db = freshDb(); nextId = 100;
  addConfirmed(db, 12);
  doc = addCandidate(db, { corrobs: { supplier_name: MEMHINT, worksheet_number: MEMHINT, worksheet_date: MEMHINT } });
  r = elig(db, doc);
  check('14. graduated scope files on graduation regardless of corroboration', r.eligible && r.basis === 'graduated');

  // 15. C2 round-trip: an 'auto_corroborated' claim never advances the graduation window
  db = freshDb(); nextId = 100;
  addConfirmed(db, 9);
  doc = addCandidate(db);
  documents.confirmIfReviewable(db, doc.id, { confirmed_by_username: 'Auto-filed (corroborated)', confirmed_via: 'auto_corroborated' });
  const t2 = trust.scopeTrust(db, 'Acme Ltd', 'service_worksheet', OPTS);
  check('15. 9 human + 1 auto_corroborated → still NOT graduated (window excludes machine files)',
    !t2.trusted && t2.reason === 'volume' && t2.confirmedCount === 9);

  // 16. CANARY (Oracle C4): the opts.extractions path — the one the harness overlays feed —
  // can produce an eligible verdict when corroboration is threaded, and fails CLOSED when the
  // overlay omits the column (the vacuous-green trap made visible: an un-threaded harness
  // disables the route, it never widens it).
  db = freshDb(); nextId = 100;
  addConfirmed(db, 5);
  doc = addCandidate(db);
  const rex = db.prepare('SELECT field_key, display_value, raw_value, confidence, validation_note, corrected_to, extraction_method, corroboration FROM extractions WHERE document_id = ?').all(doc.id);
  check('16. threaded opts.extractions (with corroboration) → eligible', elig(db, doc, { extractions: rex }).eligible);
  const bare = rex.map(({ corroboration, ...rest }) => rest);
  check('16b. overlay WITHOUT corroboration → fails closed (route off, not widened)',
    !elig(db, doc, { extractions: bare }).eligible);

  // 17. THE PELICAN I→1 EXHIBIT (Oracle C4): mapping+keyword can agree on a SHARED glyph
  // misread (full-page OCR carries the same serif I→1) — with the separator guard armed that
  // doc commits wrong, clean, corroborated at 94: ONE POINT under the floor. The margin is the
  // last defence; pin that a corroborated 94 NEVER files, so nobody "helpfully" rounds the
  // band down. Standing rule (recorded here): corroboration_autofile and
  // CODE_SEPARATOR_STRUCTURE_GUARD never flip in the same release without re-running the arms.
  doc = addCandidate(db, { conf: 94 });
  r = elig(db, doc);
  check('17. corroborated at 94 → below-floor (the I→1 exhibit margin is load-bearing)',
    !r.eligible && r.reason === 'below-floor' && r.floor >= 95);

  // 18. THE WRONG-BINDING LEAK SHAPES (Oracle C3b substitute — the 21-doc sandbox poison state
  // no longer exists, so the leak's three corroboration shapes are pinned directly):
  //   (a) frozen wrong issuer (memory) + the page's keyword DISAGREEING → refused (disagree);
  //   (b) frozen wrong issuer + hint echoing it (both descend from the poison confirms) with the
  //       page disagreeing → refused (disagree beats agree — any independent disagreement kills);
  //   (c) the residual that CAN license — pinned as 18c below. NOTE (Oracle correction, flip
  //       review): template_identity_on_page does NOT mitigate the buyer-issued class — the
  //       owner's name IS printed on the page (as recipient), so that guard is satisfied BY
  //       CONSTRUCTION; it closes the supplier-issued class only. The mitigations that remain
  //       are C1 (the wrong scope needs ≥3 clean human confirms, zero corrections ever) and
  //       docTrustGate's history check; the measurement that closes it is the recreated
  //       poison-state replay (Oracle trailing condition 2, owed before default-ON).
  db = freshDb(); nextId = 100;
  addConfirmed(db, 5);
  const LEAK_A = JSON.stringify({ winner_family: 'memory', agree: [],
    disagree: [{ family: 'keyword', value: 'Oakhaven Electrical Wholesale' }], independent_agree: false });
  const LEAK_B = JSON.stringify({ winner_family: 'memory', agree: ['hint'],
    disagree: [{ family: 'keyword', value: 'Oakhaven Electrical Wholesale' }], independent_agree: true });
  doc = addCandidate(db, { corrobs: { supplier_name: LEAK_A } });
  check('18a. wrong frozen issuer, page keyword disagrees → refused', !elig(db, doc).eligible);
  doc = addCandidate(db, { corrobs: { supplier_name: LEAK_B } });
  check('18b. memory+hint echo WITH page disagreement → refused (disagree always kills)', !elig(db, doc).eligible);

  // 18c — THE BUYER-ISSUED ABSTAIN RESIDUAL, pinned VISIBLE (Oracle flip-review condition 3).
  // On a wrong-bound buyer-issued doc the mapping box reads the owner's name from the recipient
  // block, memory agrees, and the keyword issuer pass ABSTAINS entirely (measured live: keyword
  // appears in 0 of 29 issuer records — the disagreement rail never fires on the issuer in
  // practice). fams = {memory, mapping}, mapping is a page family, disagree empty → the route
  // LICENSES this shape. That is the accepted-and-BOUNDED residual: it still needs the WRONG
  // scope to pass C1 (≥3 clean human confirms, zero corrections ever) + conf ≥95 + zero flags +
  // docTrustGate. This pin asserts the licensing outcome EXPLICITLY so the residual is breakable,
  // not latent — buyer-issued slices 2/3 (pendingfeatures) are the closing work; the recreated
  // poison-state measurement (Oracle trailing condition) is the gold-standard exercise. A change
  // that makes this pin FAIL in the refusing direction is the slice-2 fix landing — update the
  // pin to refuse, don't delete it.
  const ABSTAIN = JSON.stringify({ winner_family: 'memory', agree: ['mapping'], disagree: [], independent_agree: true });
  doc = addCandidate(db, { corrobs: { supplier_name: ABSTAIN } });
  check('18c. abstain residual: memory+mapping, no keyword voice → LICENSED (named, bounded, owed slice 2/3)',
    elig(db, doc).eligible);

  console.log('\n' + (fails ? `${fails} FAILED` : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
}

main();
