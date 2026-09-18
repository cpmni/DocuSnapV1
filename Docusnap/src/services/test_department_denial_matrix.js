'use strict';
/**
 * test_department_denial_matrix.js — Departments the FLIP proof (Oracle 2026-09-17 gate item 7).
 * The load-bearing feature-safety pin: an OUTSIDER (not in the doc's department, not all_departments, not
 * admin) sees ZERO restricted documents across every reader × transport, the route-PARTY carve-out both
 * grants the routed doc AND does not leak the department's other docs, and the visibleDocSql fragment
 * cannot silently vanish (a per-reader mutation oracle). Complements test_department_visibility.js §1-§15
 * (which prove each reader in isolation) by proving the adversary case across the surface set at once.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_department_denial_matrix.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const access = require('./accessService');
const dept = require('./departmentService');
const documents = require('../../database/modules/documents');
const dv = require('../../database/modules/departmentVisibility');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };
const allow = (u, id) => access.canAccessDocument(db, u, id).allow;

// ── one seeded multi-department world ──
let db;
function seed() {
  db = new Database(':memory:');
  runMigrations(db);
  const uid = (role, all = 0) => db.prepare('INSERT INTO users (username, display_name, password_hash, role, all_departments) VALUES (?,?,?,?,?)')
    .run('u' + Math.random().toString(36).slice(2, 8), 'u', 'x', role, all).lastInsertRowid;
  const admin = { role: 'admin', id: uid('admin') };
  const editFin = { role: 'edit', id: uid('edit') };
  const editHr = { role: 'edit', id: uid('edit') };       // HR-only member (D7 "in one of a doc's departments")
  const editNone = { role: 'edit', id: uid('edit') };     // THE ADVERSARY (writer, no department)
  const party = { role: 'edit', id: uid('edit') };        // a route recipient, no department
  const acct = { role: 'edit', id: uid('edit', 1) };      // all_departments
  const roNone = { role: 'readonly', id: uid('readonly') };
  const fin = dept.createDepartment(db, admin, 'Finance').id;
  const hr = dept.createDepartment(db, admin, 'HR').id;
  dept.setMembership(db, admin, editFin.id, [fin]);
  dept.setMembership(db, admin, editHr.id, [hr]);
  // D7: tag a doc into a SET of departments via the join (the gate reads document_departments).
  const mkMulti = (status, ...deptIds) => { const id = db.prepare("INSERT INTO documents (original_filename, folder_path, status) VALUES ('d.pdf','/in',?)").run(status).lastInsertRowid; for (const d of deptIds) if (d != null) db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?,?)').run(id, d); return id; };
  const mk = (status, deptId) => mkMulti(status, deptId);
  // status × department grid
  const grid = {};
  for (const st of ['pending', 'needs_review', 'deferred', 'error', 'confirmed', 'deleted'])
    for (const [dn, dId] of [['shared', null], ['fin', fin], ['hr', hr]])
      grid[`${st}_${dn}`] = mk(st, dId);
  grid.needs_review_finhr = mkMulti('needs_review', fin, hr);   // D7: a doc in BOTH Finance and HR
  const route = (docId, toId, state) => db.prepare(
    "INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state) VALUES (?,?,?,?,?, 'approve', ?)"
  ).run(docId, admin.id, 'admin', toId, 'party', state);
  route(grid.needs_review_hr, party.id, 'pending');   // OPEN route → party (an HR outsider)
  route(grid.confirmed_hr, roNone.id, 'approved');    // CLOSED route → roNone (carve-out must have ended)
  return { admin, editFin, editHr, editNone, party, acct, roNone, fin, hr, grid };
}

console.log('§1 route-PARTY carve-out — the trickiest correctness point');
{
  const { party, roNone, grid } = seed();
  check('open-route party CAN access the routed HR doc (reason route_party)',
    allow(party, grid.needs_review_hr) && access.canAccessDocument(db, party, grid.needs_review_hr).reason === 'route_party');
  // ...but the grant is per-doc, NOT department-list inclusion: the routed doc must NOT appear in the
  // party's department-scoped lists (party is not in HR). It reaches them via their WORKFLOW inbox only.
  check('the routed doc does NOT leak into the party\'s review queue', !documents.getReviewQueue(db, party).some(r => r.id === grid.needs_review_hr));
  check('the routed doc does NOT leak into the party\'s search', !documents.search(db, { viewer: party }).some(r => r.id === grid.needs_review_hr));
  check('a DIFFERENT HR doc stays denied to the party (grant is one doc, not the department)', !allow(party, grid.confirmed_hr) && !allow(party, grid.pending_hr));
  check('CLOSED route → the carve-out has ended (roNone denied the HR confirmed doc)', !allow(roNone, grid.confirmed_hr));
}

console.log('§2 adversary sees ZERO restricted docs across every list reader (+ mutation oracle)');
{
  const { editNone, fin, hr, grid } = seed();
  const restricted = new Set(Object.entries(grid).filter(([k]) => k.endsWith('_fin') || k.endsWith('_hr')).map(([, v]) => v));
  // reader → ids(viewer). SYSTEM_ACTOR is the "no fragment" oracle: real(adversary) must be a STRICT subset
  // of the unfiltered read AND must contain no restricted doc. Drop the fragment from a reader and real
  // would equal unfiltered → the strict-subset assertion fails (the pin is not vacuous).
  const readers = {
    'search':        (u) => documents.search(db, { viewer: u }).map(r => r.id),
    'reviewQueue':   (u) => documents.getReviewQueue(db, u).map(r => r.id),
    'deferredQueue': (u) => documents.getDeferredQueue(db, u).map(r => r.id),
    'stuckQueue':    (u) => documents.getStuckQueue(db, u).map(r => r.id),
    'deletedQueue':  (u) => documents.getDeletedQueue(db, u).map(r => r.id),
    'getByIds':      (u) => documents.getByIds(db, Object.values(grid), u).map(r => r.id),
  };
  for (const [name, rd] of Object.entries(readers)) {
    const real = new Set(rd(editNone));
    const unfiltered = new Set(rd(dv.SYSTEM_ACTOR));
    const leaked = [...real].filter(id => restricted.has(id));
    check(`${name}: adversary sees NO restricted doc`, leaked.length === 0);
    // non-vacuity: the unfiltered read DID include restricted docs of that surface, and real is strictly smaller
    const unfilteredHasRestricted = [...unfiltered].some(id => restricted.has(id));
    check(`${name}: mutation oracle — real ⊊ unfiltered (the fragment is doing work)`, unfilteredHasRestricted && real.size < unfiltered.size);
  }
  check('counts match their lists for the adversary (no existence leak via a count)',
    documents.getReviewCount(db, editNone) === documents.getReviewQueue(db, editNone).length
    && documents.getDeferredCount(db, editNone) === documents.getDeferredQueue(db, editNone).length);
}

console.log('§3 per-doc gate (canAccessDocument) denies every restricted doc to the adversary');
{
  const { editNone, acct, admin, grid } = seed();
  const restrictedNonDeleted = Object.entries(grid).filter(([k]) => (k.endsWith('_fin') || k.endsWith('_hr')) && !k.startsWith('deleted_')).map(([, v]) => v);
  check('adversary denied every restricted (non-deleted) doc with reason department_restricted',
    restrictedNonDeleted.every(id => { const r = access.canAccessDocument(db, editNone, id); return r.allow === false && r.reason === 'department_restricted'; }));
  check('all_departments (accountant) allowed every restricted doc it is not deleted', restrictedNonDeleted.every(id => allow(acct, id)));
  check('admin allowed everything', Object.values(grid).every(id => allow(admin, id)));
  check('adversary CAN see every shared (untagged) non-deleted doc',
    ['pending_shared', 'needs_review_shared', 'deferred_shared', 'error_shared', 'confirmed_shared'].every(k => allow(editNone, grid[k])));
}

console.log('§4 /v1 + stamp transports run the same per-doc gate (source-contract)');
{
  const asrc = fs.readFileSync(path.join(__dirname, '../modules/api/handler.js'), 'utf8');
  check('/v1 search threads the session user+role (viewer-aware), never an unfiltered read',
    /searchService\.searchDocuments\(\{[\s\S]{0,160}role:\s*session\.role[\s\S]{0,80}userId:\s*session\.userId/.test(asrc));
  check('/v1 list/by-id doors thread the session actor (actorOf), not an unfiltered read', /actorOf\(session\)/.test(asrc));
}

console.log('§5 D7 multi-tag — a doc in {Finance, HR} is visible to EITHER member (OR across the set) + MIN() mutation oracle');
{
  const { editFin, editHr, editNone, admin, acct, grid } = seed();
  const finhr = grid.needs_review_finhr;
  check('a {Finance,HR} doc is visible to the Finance-only member', allow(editFin, finhr));
  check('...and to the HR-only member (OR across the set)', allow(editHr, finhr));
  check('...and to admin + all_departments', allow(admin, finhr) && allow(acct, finhr));
  check('...but DENIED to an outsider in neither', !allow(editNone, finhr) && access.canAccessDocument(db, editNone, finhr).reason === 'department_restricted');
  // It appears in each member's review queue, and NOT the outsider's.
  const inQueue = (u) => documents.getReviewQueue(db, u).some(r => r.id === finhr);
  check('the {Finance,HR} doc is in BOTH members\' review queues, not the outsider\'s', inQueue(editFin) && inQueue(editHr) && !inQueue(editNone));
  // MUTATION ORACLE (Oracle #3): a scalar-emulating reader that keyed on MIN(department_id) would WRONGLY hide
  // the doc from the HR-only member (fin < hr) — proving the set-OR does real work vs a single-column reader.
  const minDept = db.prepare('SELECT MIN(department_id) m FROM document_departments WHERE document_id = ?').get(finhr).m;
  const hrMember = new Set(dept.userDepartmentIds(db, editHr.id));
  check('MIN() scalar-emulation WOULD wrongly deny the HR member (proves the set-OR is load-bearing)', !hrMember.has(minDept) && allow(editHr, finhr));
}

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
