'use strict';

/**
 * modules/filing/filename_pattern.js
 * Token-based filename pattern builder for filed (committed) documents.
 *
 * Lets users customise the committed filename format from Settings → File
 * Naming without exposing arbitrary scripting — patterns are plain strings
 * containing {tokens} and literal separator text, e.g. "{docType}.{date}.{ref}".
 *
 * Kept pure / side-effect-free (no fs, db, or IPC) so it can be exercised
 * directly from both the filing pipeline and the Settings preview, and
 * covered by a standalone unit test — see test_filename_pattern.js.
 */

// {title} joined the DEFAULT 2026-07-18 (Generic Document design slice 6, owner-confirmed):
// byte-identical for every typed doc — in v1 only General Documents carry a title, and an
// empty token collapses (no dangling separators). PINNED by test_filename_pattern.js; any
// future typed-doc title extension MUST revisit this default before shipping (design §11 Q8).
const DEFAULT_PATTERN = '{docType}.{date}.{ref}.{title}';

// `short` = the compact caption shown ON the pill block in the visual pattern
// editor (shared/pattern-editor.js); `label` is the fuller description kept for the
// palette tooltip. Additive display metadata only — validation keys off `token`.
const SUPPORTED_TOKENS = [
  { token: '{docType}',      label: 'Document type',                            short: 'Type',      example: 'Invoice' },
  { token: '{date}',         label: 'Document date (DD-MM-YYYY)',               short: 'Date',      example: '15-12-2025' },
  { token: '{ref}',          label: 'Reference number',                         short: 'Reference', example: 'INV-2025-0142' },
  { token: '{supplier}',     label: 'Document Issuer',                          short: 'Issuer',    example: 'Acme-Supplies-Ltd' },
  { token: '{year}',         label: 'Document year',                            short: 'Year',      example: '2025' },
  { token: '{month}',        label: 'Document month name',                      short: 'Month',     example: 'December' },
  { token: '{originalName}', label: 'Original scanned filename (no extension)', short: 'Filename',  example: 'scan0042' },
  // Generic Document Auto-Title (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §6). Empty on
  // docs without a title (v1: every typed doc), and an empty token collapses cleanly — so
  // adding {title} to a pattern is byte-identical for typed docs. Registration MUST ship
  // before any UI suggests the token (an unknown token makes the whole pattern fall back
  // to default — TOKEN_NAMES below is the validator).
  { token: '{title}',        label: 'Document title (Auto-Title / typed at review)', short: 'Title', example: 'Boiler-Service-Certificate' },
];

// The curated, meaningful blocks offered in the builder UI (Settings + first-run
// wizard) for BOTH folder structure and file name — click to insert, type custom
// text between them. A superset ({originalName}) is still accepted if typed by hand.
const FIELD_TOKENS = ['{supplier}', '{docType}', '{date}', '{ref}', '{year}', '{month}', '{title}']
  .map(tok => SUPPORTED_TOKENS.find(t => t.token === tok));

// Default subfolder pattern built UNDER the (separately configured) output root.
// "/" separates subfolder levels. This is the long-standing Company/Year/Month
// layout, so installs that never change it are byte-identical.
const DEFAULT_FOLDER_PATTERN = '{supplier}/{year}/{month}';

const TOKEN_NAMES = new Set(SUPPORTED_TOKENS.map(t => t.token));
const TOKEN_RE    = /\{[a-zA-Z]+\}/g;
const ILLEGAL_RE  = /[\\/:*?"<>|]/g;
const SEP_RUN_RE  = /[.\-_ ]{2,}/g;
const SEP_EDGE_RE = /^[.\-_ ]+|[.\-_ ]+$/g;

// Windows reserves these device names for the component of a filename before
// the *first* "." — regardless of extension or what follows ("CON.pdf" and
// "CON.2025.pdf" are both unusable, case-insensitively). Anything that isn't
// an exact match (e.g. "CONTRACT", "COM10") is perfectly fine.
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function sanitiseValue(text, maxLen = 60) {
  return String(text == null ? '' : text)
    .replace(ILLEGAL_RE, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, maxLen);
}

// Syntactic validation only. Whether a *specific document's* values produce a
// usable filename is a runtime question — {ref} alone is a perfectly good
// pattern that only comes up empty on documents that genuinely have no
// reference number, so that case is handled by buildFilename()'s fallback,
// not rejected here.
function validatePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { valid: false, reason: 'Pattern is empty.' };
  }
  const tokens = pattern.match(TOKEN_RE) || [];
  for (const t of tokens) {
    if (!TOKEN_NAMES.has(t)) {
      return { valid: false, reason: `Unsupported token: ${t}` };
    }
  }
  const hasLiteralChars = pattern.replace(TOKEN_RE, '').replace(/[^a-zA-Z0-9]/g, '').length > 0;
  if (tokens.length === 0 && !hasLiteralChars) {
    return { valid: false, reason: 'Pattern has no tokens or usable text.' };
  }
  return { valid: true, reason: null };
}

// Final Windows-safety pass over an assembled filename stem (no extension —
// the caller appends that separately, untouched, so it's always preserved).
// This is the backend guarantee: it runs in the filing path on every
// committed document regardless of what the Settings UI already validated,
// and it guarantees the result is either '' (handled by buildFilename's
// fallback chain) or a name Windows will accept outright. Four passes:
//   1. Strip the nine characters Windows forbids outright: \ / : * ? " < > |
//   2. Collapse runs of separator-ish characters ('.', '-', '_', ' ') that an
//      empty token (or adjacent literal separators) would otherwise leave
//      behind — "Invoice..INV-001" -> "Invoice.INV-001"
//   3. Trim leading/trailing separator-ish characters. Because '.' and ' '
//      both belong to that set, this step *is* the guarantee that the result
//      never starts/ends in a space or period — trailing space/period are
//      illegal as the final character of a Windows name ("Invoice " and
//      "Invoice." are both rejected by the OS)
//   4. Defuse reserved Windows device names (CON, PRN, AUX, NUL, COM1-9,
//      LPT1-9): append "_" to just the leading dot-component so "CON" becomes
//      "CON_" and "CON.2025" becomes "CON_.2025" — breaks the reserved match
//      while keeping the rest of the assembled name intact and readable
function sanitiseFilenameStem(stem) {
  let s = String(stem == null ? '' : stem)
    .replace(ILLEGAL_RE, '')
    .replace(SEP_RUN_RE, m => m[0])
    .replace(SEP_EDGE_RE, '');

  const parts = s.split('.');
  if (RESERVED_NAMES.has(parts[0].toUpperCase())) {
    parts[0] += '_';
    s = parts.join('.');
  }
  return s;
}

// Substitute tokens (sanitising each value individually so a token's content
// can never introduce illegal characters or path separators), then run the
// assembled stem through the same Windows-safety pass that guards the rest
// of the filing path — see sanitiseFilenameStem for exactly what that does.
function buildFilenameStem(pattern, values) {
  const raw = pattern.replace(TOKEN_RE, (match) => {
    const value = values[match.slice(1, -1)];
    return value ? sanitiseValue(value) : '';
  });
  return sanitiseFilenameStem(raw);
}

// Build the final filename (stem + extension) from a pattern and the
// resolved token values for one document. Returns which pattern actually
// produced the result so callers can log/surface a fallback:
//   - an invalid pattern (unsupported token, empty, etc.) falls back to
//     DEFAULT_PATTERN entirely
//   - a syntactically valid pattern that produces an empty filename for THIS
//     document's data (e.g. "{ref}" on a document with no reference number)
//     also falls back to DEFAULT_PATTERN, and finally to a bare "Document"
//     name if even that comes up empty (which cannot happen with real data,
//     since {docType} always resolves to something)
function buildFilename({ pattern, values, ext }) {
  const check = validatePattern(pattern);
  if (!check.valid) {
    return {
      filename: `${buildFilenameStem(DEFAULT_PATTERN, values) || 'Document'}${ext}`,
      fellBack: true,
      reason:   check.reason,
    };
  }

  const stem = buildFilenameStem(pattern, values);
  if (stem) return { filename: `${stem}${ext}`, fellBack: false, reason: null };

  if (pattern !== DEFAULT_PATTERN) {
    const fallbackStem = buildFilenameStem(DEFAULT_PATTERN, values);
    if (fallbackStem) {
      return {
        filename: `${fallbackStem}${ext}`,
        fellBack: true,
        reason:   'Pattern produced an empty filename for this document.',
      };
    }
  }
  return {
    filename: `Document${ext}`,
    fellBack: true,
    reason:   'Pattern produced an empty filename for this document.',
  };
}

// Resolve filename collisions exactly as before: "-DUPLICATE", then
// "-DUPLICATE-2", "-DUPLICATE-3", etc. Takes an existsFn(name) so it stays
// pure/testable — the caller supplies the directory to check against.
function resolveDuplicateFilename(baseFilename, ext, existsFn) {
  if (!existsFn(baseFilename)) return baseFilename;

  const stem = baseFilename.slice(0, -ext.length);
  let candidate = `${stem}-DUPLICATE${ext}`;
  let n = 2;
  while (existsFn(candidate)) {
    candidate = `${stem}-DUPLICATE-${n}${ext}`;
    n++;
  }
  return candidate;
}

// The subfolder a duplicate is filed into under the 'subfolder' policy.
const DUPLICATES_SUBFOLDER = 'Duplicates';

// Resolve the SUFFIX token for the 'suffix' policy. Default 'DUPLICATE' (byte-identical to the old
// behaviour). Reserved words: 'COPY' -> -COPY; 'number' -> pure counter (-2, -3); 'date' -> the
// import date (-YYYY-MM-DD). Anything else is a CUSTOM suffix, run through the same Windows-safety
// pass as a filename stem. `now` is injectable for testable 'date'.
function _duplicateTag(suffix, now) {
  const s = (suffix == null ? 'DUPLICATE' : String(suffix)).trim();
  const up = s.toUpperCase();
  if (!s || up === 'DUPLICATE') return 'DUPLICATE';
  if (up === 'COPY') return 'COPY';
  if (s.toLowerCase() === 'number') return '';            // pure counter, no word
  if (s.toLowerCase() === 'date') {
    const d = now instanceof Date ? now : new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return sanitiseFilenameStem(s) || 'DUPLICATE';          // custom -> safe, never empty
}

// Policy-aware duplicate resolution. Returns { filename, subfolder }. `existsIn(name, subfolder)`
// checks whether `name` already exists in targetDir/subfolder (subfolder '' = the target dir), with
// the caller excluding the doc's OWN current copy (a re-file is not a collision). Policies:
//   'suffix'   (default) — keep both files in the same folder with a suffix (see _duplicateTag).
//   'subfolder'          — file the duplicate into a 'Duplicates' subfolder, same name (suffix only
//                          if it ALSO collides there, i.e. a duplicate-of-a-duplicate).
// The 'suffix'/'DUPLICATE' path is byte-identical to resolveDuplicateFilename.
function resolveDuplicate(baseFilename, ext, existsIn, opts = {}) {
  const policy = opts.policy === 'subfolder' ? 'subfolder' : 'suffix';
  if (!existsIn(baseFilename, '')) return { filename: baseFilename, subfolder: '' };

  const stem = baseFilename.slice(0, -ext.length);

  if (policy === 'subfolder') {
    const sub = DUPLICATES_SUBFOLDER;
    if (!existsIn(baseFilename, sub)) return { filename: baseFilename, subfolder: sub };
    let n = 2, cand = `${stem}-${n}${ext}`;
    while (existsIn(cand, sub)) { n++; cand = `${stem}-${n}${ext}`; }
    return { filename: cand, subfolder: sub };
  }

  const tag = _duplicateTag(opts.suffix, opts.now);
  if (!tag) {                                             // 'number' style: -2, -3, …
    let n = 2, cand = `${stem}-${n}${ext}`;
    while (existsIn(cand, '')) { n++; cand = `${stem}-${n}${ext}`; }
    return { filename: cand, subfolder: '' };
  }
  let cand = `${stem}-${tag}${ext}`, n = 2;
  while (existsIn(cand, '')) { cand = `${stem}-${tag}-${n}${ext}`; n++; }
  return { filename: cand, subfolder: '' };
}

// Preview (Settings → Files & filing): the name the FIRST duplicate of `baseFilename` receives
// under `suffix`. PURE, no disk check — mirrors the 'suffix' branch of resolveDuplicate so the UI
// preview can never drift from filing-time behaviour. `now` injectable for the 'date' token.
function previewDuplicateName(baseFilename, ext, suffix, now) {
  const stem = (ext && baseFilename.endsWith(ext)) ? baseFilename.slice(0, -ext.length) : baseFilename;
  const tag = _duplicateTag(suffix, now);
  return tag ? `${stem}-${tag}${ext}` : `${stem}-2${ext}`;   // '' tag = the 'number' style (-2, -3, …)
}

// Build the subfolder segments for one document from a folder PATTERN. "/" in the
// pattern separates subfolder levels; each level is token-substituted and run
// through the same Windows-safety pass as a filename stem (illegal chars stripped,
// reserved device names defused, separator edges trimmed). Empty levels — from an
// unresolved token or stray "/" — are dropped, so the path never contains a blank
// or unsafe folder. Pure: the caller (filing handler) still enforces the
// output-root containment check on the joined result.
function buildFolderSegments(pattern, values) {
  return String(pattern == null ? '' : pattern)
    .split('/')
    .map(seg => buildFilenameStem(seg, values))
    .filter(Boolean);
}

module.exports = {
  DEFAULT_PATTERN,
  DEFAULT_FOLDER_PATTERN,
  SUPPORTED_TOKENS,
  FIELD_TOKENS,
  RESERVED_NAMES,
  validatePattern,
  sanitiseFilenameStem,
  buildFilenameStem,
  buildFilename,
  buildFolderSegments,
  resolveDuplicateFilename,
  resolveDuplicate,
  previewDuplicateName,
  DUPLICATES_SUBFOLDER,
};
