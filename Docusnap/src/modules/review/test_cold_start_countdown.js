'use strict';
/*
 * test_cold_start_countdown.js — PINs for the cold-start hold reason (2026-08-18).
 *
 * THE FINDING (measured on the owner's own fresh install, 53 queued docs): 34 were refused with
 * `unverifiable-value:supplier_name`, and Review told them only that the field "couldn't be
 * checked automatically". The honest cause was mundane — those senders had TWO confirmed
 * documents, and a learned format stays in the provisional channel (which docTrustGate
 * deliberately cannot see) until FORMAT_SOLID_MIN confirms exist. So a correctly-read document
 * from a young sender cannot auto-file below 100, and nothing on screen said what would change
 * that. The customer's only visible lever became "Reprocess All", which re-reads every page and
 * produces the identical answer ~92% of the time (measured, stress_test/taught_autofile_counterfactual.js).
 *
 * Oracle's ruling on the wider arc was SEND BACK on the trust-gate change (the diagnosis behind it
 * was wrong — see the partition harness) but "ship the refusal-reason surfacing regardless: the
 * highest reward-to-risk item, and a UI change rather than a filing-gate change". This is that.
 *
 * NOTHING here is a gate: the counts are advisory payload on an existing read-only IPC.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/review/test_cold_start_countdown.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. the threshold is a NAMED constant shared with the format builder');
check('learning.FORMAT_SOLID_MIN is exported and is 3', learning.FORMAT_SOLID_MIN === 3);
{
  const src = fs.readFileSync(path.join(REPO, 'database', 'modules', 'learning.js'), 'utf8');
  check('getFieldFormats uses the constant, not a bare 3 (so the copy can never drift from the rule)',
        /_ok: g\._values\.size >= FORMAT_SOLID_MIN \|\| g\._count >= FORMAT_SOLID_MIN/.test(src));
}

console.log('2. the rule the countdown describes is REAL (a group is provisional below the bar)');
{
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1,'Invoice','invoice',1)").run();
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,'supplier_name','Document Issuer','text',1,1)").run();
  const addConfirmed = (n) => {
    for (let i = 0; i < n; i++) {
      const r = db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name, overall_confidence)
                            VALUES (1, ?, '/in', 'confirmed', 'Meadowvale Dairy Wholesale', 93)`).run(`d${i}.pdf`);
      db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
                  VALUES (?, 'supplier_name', 'Meadowvale Dairy Wholesale', 'Meadowvale Dairy Wholesale', 95, 'template_fixed')`).run(r.lastInsertRowid);
    }
  };
  const solidFor = () => (learning.getFieldFormats(db) || [])
    .some(f => f.field_key === 'supplier_name' && String(f.supplier_name || '').trim());
  addConfirmed(learning.FORMAT_SOLID_MIN - 1);
  check(`at ${learning.FORMAT_SOLID_MIN - 1} confirms the sender has NO solid format (the held state)`, solidFor() === false);
  check('...though it EXISTS provisionally (which is why the hold looks like a mystery)',
        (learning.getFieldFormats(db, { includeProvisional: true }) || [])
          .some(f => f.field_key === 'supplier_name' && String(f.supplier_name || '').trim()));
  addConfirmed(1);
  check(`at ${learning.FORMAT_SOLID_MIN} confirms it becomes solid — the countdown's promise is true`, solidFor() === true);
  db.close();
}

console.log('3. the IPC attaches the counts, and only for this cause');
{
  const src = fs.readFileSync(path.join(REPO, 'src', 'modules', 'review', 'handler.js'), 'utf8');
  check("only on kind 'unverifiable-value' with a named field",
        /if \(kind === 'unverifiable-value' && field\) \{/.test(src));
  check('counts come from confirmed docs in the SAME scope', /status = 'confirmed' AND document_type_id = \?[\s\S]{0,120}supplier_name/.test(src));
  check('the need is read from the shared constant', /learning'\)\.FORMAT_SOLID_MIN/.test(src));
  check('omitted once the sender is past the bar (no countdown on a mature scope)', /if \(n < need\) \{ out\.scopeConfirms = n; out\.confirmsNeeded = need; \}/.test(src));
  check('advisory only — wrapped so it can never break the panel', /catch \{ \/\* advisory — never break the reason panel \*\/ \}/.test(src));
}

console.log('4. the copy states the cause and what clears it');
{
  const r = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  check('names the sender and the remaining count', /Confirm \$\{_left === 1 \? 'this one' : `\$\{_left\} more`\}/.test(r));
  check('promises the payoff in the customer\'s terms', /can start filing themselves/.test(r));
  check('falls back to the old wording when the counts are absent', /couldn't be checked automatically, so this one is waiting for your eye/.test(r));
  check('the cue reports PROGRESS instead of repeating "waiting"', /\$\{_have\} of \$\{_need\} confirmed from this sender/.test(r));
  check('the tail no longer contradicts the lead with threshold advice',
        /it counts towards this sender filing on its own/.test(r));
}

console.log('5. the stale layout note is reported as its own class (owner-found 2026-08-18)');
{
  const h = fs.readFileSync(path.join(REPO, 'src', 'modules', 'review', 'handler.js'), 'utf8');
  check('the IPC recognises the stale-layout class', /out\.kind = 'stale-layout-note'/.test(h));
  check('...only when EVERY note on the doc is that class (one real flag still reports flagged)',
        /stale\.length && stale\.length === noted\.length/.test(h));
  check('...and only once the sender HAS a confirmed doc of that type — what makes it stale',
        /if \(n > 0\) \{ out\.kind = 'stale-layout-note'/.test(h));
  const r = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  check('the copy calls the note out of date and points at the ONE-document re-read',
        /is still attached to it\. The note is out of date/.test(r));
  check('the summary prefers the post-strip extractions over the server flag count',
        /server count is only the pre-load placeholder/.test(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
