#!/usr/bin/env node
'use strict';
/*
 * test_teach_fragment_name_guard.js — Chris round 18 card A2 (2026-08-23).
 *
 * THE INCIDENT: the issuer-step warning ("DOCUMENT" is part of DOCUMENT SOLUTIONS … would start a
 * second folder) rendered with a ghost "Use" button while the big blue "Looks right →" stayed the
 * primary directly under it; one click past it minted sender "DOCUMENT", the summary and Save asked
 * nothing, and a later Reprocess handed five siblings to the fragment.
 *
 * Source-contract pins on src/windows/teach/renderer.js:
 *   • when a known full name is on offer the Use button is PRIMARY and "Looks right →" demotes to a
 *     ghost "Keep "v" anyway"
 *   • doCommit asks ONCE MORE at Save (before promoteToTemplate) via the same near-match lookup;
 *     Use rewrites the issuer result and re-runs commit; Keep sets issuerNearMatchAck
 *   • the wizard's confirm carries acknowledgeIssuerNearMatch from that ack (so the service gate
 *     honours the deliberate second company instead of refusing the commit)
 *   • the ask sits BEFORE the promote call (the template must not be born with the fragment name)
 *
 * Run: node src/windows/teach/test_teach_fragment_name_guard.js
 */
const fs = require('fs'), path = require('path');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').split(CR + LF).join(LF);
let fails = 0;
const check = (l, ok) => { console.log(`  ${ok ? 'OK ' : 'BAD'} ${l}`); if (!ok) fails++; };

console.log('issuer step:');
const warn = src.slice(src.indexOf('async function _warnOnIssuerValue'), src.indexOf('function showValueConfirm('));
check('the Use "<full name>" button is PRIMARY when a known name is offered', /class="btn primary" id="rb-use-known"/.test(warn));
check('…and "Looks right →" demotes to a ghost "Keep "v" anyway"', /yes\.classList\.remove\('primary'\); yes\.classList\.add\('ghost', 'quiet'\); yes\.textContent = `Keep "\$\{v\}" anyway`/.test(warn));
check('no ghost Use button remains (the old role)', !/class="btn ghost quiet" id="rb-use-known"/.test(warn));

console.log('\nSave:');
const commit = src.slice(src.indexOf('async function doCommit'), src.indexOf('async function doCommit') + 9000);
const askAt = commit.indexOf('state.issuerNearMatchAck && supplier && D.checkIdentityNearMatch');
const promoteAt = commit.indexOf('const promo=await D.promoteToTemplate');
check('doCommit re-asks with the same near-match lookup', askAt > 0 && /checkIdentityNearMatch\(\{ value: supplier, templateId:/.test(commit));
check('…BEFORE the template is promoted', askAt > 0 && promoteAt > askAt);
check('Use rewrites the issuer result (valueSource known-name) and re-runs commit', /state\.results\[isf\.key\]\.value = nm\.existing; state\.results\[isf\.key\]\.valueSource = 'known-name';[\s\S]{0,120}doCommit\(\);/.test(commit));
check('Keep anyway sets the ack and re-runs commit', /\$\('nm-keep'\)\?\.addEventListener\('click', \(\) => \{ state\.issuerNearMatchAck = true;[\s\S]{0,80}doCommit\(\); \}\);/.test(commit));
check('the confirm payload carries acknowledgeIssuerNearMatch from the ack', /acknowledgeIssuerNearMatch: !!state\.issuerNearMatchAck/.test(commit));
check('the sub-run wording names the second folder; the edit-distance wording names two spellings', /saving it would start a second folder/.test(commit) && /two spellings file into two folders/.test(commit));

console.log('
r19 N3 — the wrong-kind-of-value warning demotes the primary (the s55 screenshot):');
check('when _cohWarn fires, "Looks right →" becomes a ghost "Use it anyway" and Redraw becomes the primary',
      /if \(_cohWarn\) \{[\s\S]{0,400}_yes\.textContent = 'Use it anyway'[\s\S]{0,300}_rd\.classList\.add\('primary'\)/.test(src));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
