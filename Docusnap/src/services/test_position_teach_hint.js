#!/usr/bin/env node
'use strict';
/*
 * test_position_teach_hint.js — Card 1 (Chris R5): the "draw a box to teach the next one" nudge,
 * on a REAL migrated DB. DARK behind POSITION_TEACH_NUDGE / position_teach_nudge.
 *
 * The load-bearing pins are Oracle's (2026-08-26): the nudge must NOT fire when a ⊕ box was drawn,
 * when a field_anchor exists, when a Stage-0.5 template MAPPING exists (the dead-guard POSITIVE
 * CONTROL — a wizard-taught field, resolved by template id not supplier), or when a fixed_value
 * exists; it must fire ONCE per scope (suppression); it must be value-blind; OFF must be inert.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_position_teach_hint.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const doctypes = require('../../database/modules/document_types');
const learning = require('../../database/modules/learning');
const svc = require('./positionTeachHintService');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  doctypes.seedBuiltInTypes(db);
  return db;
}
const dt = (db) => doctypes.getWithFields(db, 'invoice');
const EMPTY_FILL = { invoice_number: { original_value: '', corrected_value: 'INV-9' } };
const base = (db, over) => Object.assign({
  documentId: 1, corrections: EMPTY_FILL, taughtFields: [], supplierName: 'Pelican',
  typeSlug: 'invoice', dtInfo: dt(db), templateId: null, learning, audit: () => {},
}, over || {});

function mkTemplate(db, { name = 'Pelican', slug = 'pelican-tpl' } = {}) {
  return db.prepare("INSERT INTO templates (name, slug, document_type_slug) VALUES (?, ?, 'invoice')").run(name, slug).lastInsertRowid;
}

// ── FIRES + value-blind + suppression ─────────────────────────────────────────────
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  const r = svc.applyForConfirm(db, base(db));
  check('FIRES: empty→typed filing field, no learned position → a nudge', !!(r && r.supplier === 'Pelican'));
  check('names the field that has no position', !!(r && r.fields && r.fields.some(f => f.key === 'invoice_number' && f.label)));
  check('value-blind: the hint carries ONLY {key,label} — never a value/confidence',
        !!r && r.fields.every(f => Object.keys(f).sort().join(',') === 'key,label'));
  const r2 = svc.applyForConfirm(db, base(db));
  check('suppression: the SAME scope is nudged only once', r2 === null);
})();

// ── does NOT fire when a ⊕ box was drawn this confirm (the wrong-layer guard) ──────
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  check('drawn: a field taught by a box this confirm is not nudged',
        svc.applyForConfirm(db, base(db, { taughtFields: ['invoice_number'] })) === null);
})();

// ── does NOT fire when a field_anchor already exists for the scope ─────────────────
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  db.prepare(`INSERT INTO field_anchors (supplier_name, document_type, field_key, anchor_label, direction, page_zone, x_norm, y_norm)
              VALUES ('Pelican', 'invoice', 'invoice_number', 'Invoice No', 'right', 'top_right', 0.5, 0.1)`).run();
  check('anchor-exists: a Stage-2 anchor for the field suppresses the nudge',
        svc.applyForConfirm(db, base(db)) === null);
})();

// ── POSITIVE CONTROL: does NOT fire when a Stage-0.5 template MAPPING exists ───────
// (the dead-guard trap Oracle named — mappings are keyed by template_id, not supplier).
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  const tid = mkTemplate(db);
  db.prepare("INSERT INTO template_field_mappings (template_id, field_key) VALUES (?, 'invoice_number')").run(tid);
  check('mapping-exists (POSITIVE CONTROL): a wizard-taught mapping on the doc\'s template suppresses the nudge',
        svc.applyForConfirm(db, base(db, { templateId: tid })) === null);
})();

// ── does NOT fire when a fixed_value exists (the field will fill, not read blank) ──
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  const tid = mkTemplate(db);
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (?, 'invoice_number', 'INV-CONST', 0)").run(tid);
  check('fixed_value: a constant-fill field is not nudged',
        svc.applyForConfirm(db, base(db, { templateId: tid })) === null);
})();

// ── never the identity field (de-dup with Card 4; issuer is by letterhead, not a box) ──
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  check('identity excluded: a typed supplier_name never triggers a position nudge',
        svc.applyForConfirm(db, base(db, { corrections: { supplier_name: { original_value: '', corrected_value: 'Pelican' } } })) === null);
})();

// ── only empty→value (a wrong→corrected tidy-up is not the "read nothing" case, v1) ──
(function () {
  process.env.POSITION_TEACH_NUDGE = '1';
  const db = fresh();
  check('wrong→corrected (non-empty original) is not nudged in v1',
        svc.applyForConfirm(db, base(db, { corrections: { invoice_number: { original_value: 'INV-8', corrected_value: 'INV-9' } } })) === null);
})();

// ── OFF is inert ──────────────────────────────────────────────────────────────────
(function () {
  process.env.POSITION_TEACH_NUDGE = '0';
  const db = fresh();
  check('OFF: the switch off returns null (byte-identical confirm)', svc.applyForConfirm(db, base(db)) === null);
  delete process.env.POSITION_TEACH_NUDGE;
})();

console.log(fails ? `\n${fails} FAILED` : '\nAll position-teach-nudge pins passed');
process.exit(fails ? 1 : 0);
