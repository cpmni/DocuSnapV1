'use strict';
/*
 * _bytenode_compile.js — compile one JS file to a V8-bytecode .jsc, run UNDER electron-as-node
 * (ELECTRON_RUN_AS_NODE=1) so the bytecode matches the SHIPPED Electron's V8 exactly. Invoked by
 * scripts/harden-js.js --bytecode. Not part of the app.
 *
 *   ELECTRON_RUN_AS_NODE=1 electron.exe scripts/_bytenode_compile.js <in.js> <out.jsc>
 */
const bytenode = require('bytenode');
const [, , input, output] = process.argv;
if (!input || !output) { console.error('_bytenode_compile: need <in.js> <out.jsc>'); process.exit(2); }
bytenode.compileFile({ filename: input, output, compileAsModule: true });
console.log(`[_bytenode_compile] ${output}`);
