'use strict';

// Static startup splash. Values are passed in via the loadFile query string by
// main.js (sourced from app.getVersion() + package.json build.copyright), so the
// splash duplicates no app metadata of its own.
const params    = new URLSearchParams(location.search);
const version   = params.get('version')   || '';
const copyright = params.get('copyright') || '';

document.getElementById('version').textContent   = version ? 'v' + version : '';
document.getElementById('copyright').textContent = copyright;
