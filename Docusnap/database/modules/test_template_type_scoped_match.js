#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_template_type_scoped_match.js
 * ---------------------------------------------------
 * TYPE-SCOPED template identification (the "Template available ↔ No template match"
 * flip-flop): a supplier issuing several doc types on ONE letterhead has same-logo,
 * same-keyword-fingerprint sibling templates. The read-only UI recheck
 * (identifyByFingerprint) used to be TYPE-BLIND, so it reported a Sales Order / PO
 * template as "available" for an Invoice — misleading, and it SUPPRESSED the
 * Teach-this-document CTA so the operator couldn't create the genuinely-missing
 * Invoice template. identifyByFingerprint now takes an optional document_type_slug
 * and only same-type templates count (mirroring Python identify_template's refusal).
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_template_type_scoped_match.js
 */

const Database  = require('better-sqlite3');
const templates = require('./templates');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      group_id INTEGER, ocr_auto_enabled INTEGER DEFAULT 0, ocr_auto_params TEXT, supplier_name TEXT
    );
    CREATE TABLE template_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT DEFAULT 'right',
      fixed_value TEXT, is_variable INTEGER DEFAULT 1, UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, detail_hash TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(template_id, phash)
    );
  `);
  return db;
}

const LOGO = 'bfcac0c01f3fc072';        // one shared letterhead logo (the Cascade case)
const KW   = ['cascade', 'water', 'systems', 'reservoir'];
const OCR  = 'cascade water systems springfield works reservoir rd invoice';

function main() {
  let f = 0;
  const db = makeDb();

  // A supplier with a Sales Order template on the shared letterhead — NO Invoice template yet.
  const SO = templates.create(db, { name: 'Cascade Water Systems', document_type_slug: 'sales_order',
    logo_phash: LOGO, keyword_fingerprint: KW });

  // ── The bug scenario: an INVOICE looking at the same letterhead. ────────────────
  // TYPE-BLIND (no slug) still matches the SO template — this is the legacy behaviour
  // preserved for callers that don't pass a slug.
  const blind = templates.identifyByFingerprint(db, { logo_phash: LOGO, ocr_text: OCR });
  f += !check('type-blind (no slug) still matches the sibling — legacy behaviour intact',
    blind && blind.template.id === SO);

  // TYPE-SCOPED to 'invoice' → the SO template must NOT count → no match → Teach CTA shows.
  const scoped = templates.identifyByFingerprint(db, { logo_phash: LOGO, ocr_text: OCR, document_type_slug: 'invoice' });
  f += !check('type-scoped to invoice → sales_order sibling does NOT match (was the flip-flop bug)',
    scoped === null);

  // Scoping to the sibling's OWN type still matches it (no false negative).
  const soScoped = templates.identifyByFingerprint(db, { logo_phash: LOGO, ocr_text: OCR, document_type_slug: 'sales_order' });
  f += !check('type-scoped to sales_order → the sibling DOES match', soScoped && soScoped.template.id === SO);

  // ── Now the missing Invoice template is created (what "Save as template" does). ──
  const INV = templates.create(db, { name: 'Cascade Water Systems', document_type_slug: 'invoice',
    logo_phash: LOGO, keyword_fingerprint: KW });
  const nowInv = templates.identifyByFingerprint(db, { logo_phash: LOGO, ocr_text: OCR, document_type_slug: 'invoice' });
  f += !check('after an Invoice template exists, the invoice matches IT (not the SO sibling)',
    nowInv && nowInv.template.id === INV);

  // ── The two finders in isolation honour the slug filter. ────────────────────────
  f += !check('findByLogoHash(slug=invoice) returns the invoice template',
    (() => { const m = templates.findByLogoHash(db, LOGO, 13, 'invoice'); return m && m.id === INV; })());
  f += !check('findByKeywordFingerprint(slug=sales_order) returns the SO template',
    (() => { const m = templates.findByKeywordFingerprint(db, OCR, 75, 'sales_order'); return m && m.template.id === SO; })());
  f += !check('findByLogoHash(slug=purchase_order) with no PO template → null',
    templates.findByLogoHash(db, LOGO, 13, 'purchase_order') === null);

  // Slug matching is case-insensitive (defensive — slugs are lower-cased everywhere).
  f += !check('slug filter is case-insensitive',
    (() => { const m = templates.findByLogoHash(db, LOGO, 13, 'Invoice'); return m && m.id === INV; })());

  console.log(f === 0 ? '\nALL PASS' : `\n${f} FAILED`);
  process.exit(f === 0 ? 0 : 1);
}

main();
