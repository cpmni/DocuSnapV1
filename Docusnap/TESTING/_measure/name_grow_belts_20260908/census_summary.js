const fs = require('fs'), path = require('path');
const dir = process.argv[2]; const c = {};
for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; try { const o = JSON.parse(l).outcome; c[o] = (c[o] || 0) + 1; } catch {} }
console.log(JSON.stringify(c));
