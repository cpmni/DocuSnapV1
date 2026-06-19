#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_text_normalise.js
 * ---------------------------------------
 * PARITY guard: the JS normaliser must produce byte-identical output to the Python
 * reference on the SHARED golden corpus (python_backend/tests/normalise_corpus.json).
 * If this fails, the renderer and backend normalisers have drifted.
 *
 *   node database/modules/test_text_normalise.js
 */

const fs   = require('fs');
const path = require('path');
const { normaliseForTokens, tokenise } = require('./text_normalise');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

const corpusPath = path.join(__dirname, '..', '..', 'python_backend', 'tests', 'normalise_corpus.json');
const CORPUS = JSON.parse(fs.readFileSync(corpusPath, 'utf-8'));

function eqArr(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); }

function main() {
  let f = 0;
  console.log('text_normalise.js matches the shared golden corpus (Py/JS parity)');
  for (const c of CORPUS) {
    f += !check(`norm ${JSON.stringify(c.in)} -> ${JSON.stringify(c.norm)}`, normaliseForTokens(c.in) === c.norm);
    f += !check(`tokens ${JSON.stringify(c.in)}`, eqArr(tokenise(c.in), c.tokens));
  }
  if (f) { console.log(`\n${f} FAILED — JS normaliser diverged from the Python golden corpus.`); process.exit(1); }
  console.log(`\nAll ${CORPUS.length} normaliser cases match (Py/JS parity holds).`);
  process.exit(0);
}

main();
