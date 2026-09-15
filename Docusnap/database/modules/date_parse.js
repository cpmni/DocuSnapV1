'use strict';
/**
 * database/modules/date_parse.js — the ONE date parser/normaliser for the core.
 *
 * Lifted VERBATIM (2026-09-15) from src/modules/filing/handler.js so there is a single source of truth
 * for "is this a real, fileable calendar date" shared by the confirm door + folder builder (filing) AND
 * the auto-file gate + re-read holds (trust._validDate). Previously trust.js carried a THIRD, looser copy
 * that validated month+day but never the YEAR, so a clipped "October 14, 202" counted as valid — the
 * owner-visible "Read differently after learning — check which is right" noise note + a gap in the
 * auto-file date gate. Delegating both to parseDate here makes the gate agree exactly with the door.
 *
 * Pure — no electron/fs/db deps — so it lives in database/modules (which never requires up into src/) and
 * both trees can require it (filing at src/ requires DOWN into database/modules, the allowed direction).
 * Mirrors the text_normalise.js twin-placement precedent. Twins to keep aligned (see the comments below):
 * validator._date_preclean / renderer._datePreclean (pre-clean), validator._wide_month_form (month-name).
 */

const MONTHS = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

// OCR date pre-clean — TWIN of validator._date_preclean + renderer._datePreclean; keep aligned.
// Rejoin an OCR-split number ("1 5" -> "15") + collapse whitespace around date separators, so a
// value that extraction normalised also normalises at confirm/filename. No-op on an already-clean
// DD-MM-YYYY (no intra-digit spaces, no spaced separators) → the normal path is byte-identical.
function _datePreclean(raw) {
  let s = String(raw == null ? '' : raw);
  if (!/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) {
    s = s.replace(/(?<=\d)\s+(?=\d)/g, '');   // gate the digit-join on the ABSENCE of a month name ("Aug 3 2024")
  }
  return s
    .replace(/\s*([/.\-])\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function parseDate(raw) {
  if (!raw) return null;
  const s = _datePreclean(raw);
  // A real calendar date or nothing: JS `new Date(y, m, d)` silently ROLLS OVER an impossible date ("31/04/2026" →
  // 1 May, "12-34-5678" → a year 5680) — the Python twin (strptime) refuses those, and so must this door
  // (2026-09-14, reggie finding). Refused → the invalid-date guard sends the value back to the operator.
  const real = (y, mo, dd) => { const d = new Date(y, mo, dd); return (d.getFullYear() === y && d.getMonth() === mo && d.getDate() === dd) ? d : null; };
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) return real(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return real(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
  // MONTH-NAME forms (text month — abbreviated OR full: "Jul"/"July"/"Sept"), 2026-09-14 reggie design (twin of
  // validator._wide_month_form): a leading day name is dropped; between the three tokens (day / month / year) sit
  // optional whitespace and AT MOST ONE of , . / \ - (none at all for an OCR-glued "23Aug2026"); the day may carry
  // an ordinal ("23rd"); the month may carry a trailing dot ("Aug.") and keys on its first three letters; the year
  // is 2 or 4 digits (a 3-digit clip stays refused; 2-digit pivots at 69 like strptime %y). A test customer's
  // "23rd Aug 2026" was refused here at confirm. NUMERIC dates are NOT widened (the month name is the guard that
  // keeps "3.5.2" / "1,234.56" / "12-34-5678" out). The calendar round-trip refuses "31 Apr" (JS Date rolls over).
  const t = s.replace(/^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s*/i, '');
  let day = null, mon = null, year = null;
  if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*[,./\\-]?\s*([A-Za-z]{3,9})\.?\s*[,./\\-]?\s*(\d{2}|\d{4})$/i))) { day = +m[1]; mon = m[2]; year = m[3]; }
  // Month-first: day → year is digits → digits, so that separator may NOT be empty ("Aug 2026" is not "Aug 20 26").
  else if ((m = t.match(/^([A-Za-z]{3,9})\.?\s*[,./\\-]?\s*(\d{1,2})(?:(?:st|nd|rd|th)\s*[,./\\-]?\s*|\s*[,./\\-]\s*|\s+)(\d{2}|\d{4})$/i))) { mon = m[1]; day = +m[2]; year = m[3]; }
  if (mon !== null) {
    const mo = MONTHS[mon.slice(0, 3).toLowerCase()];
    if (mo === undefined) return null;
    let y = +year; if (year.length === 2) y += (y >= 69 ? 1900 : 2000);
    return real(y, mo, day);
  }
  return null;
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// The CANONICAL date normaliser — the ONE place a submitted date string is turned into the
// core's stored/filed format (DD-MM-YYYY). Reused by the filename builder AND the confirm path
// (reviewService) so a desktop or /v1 client never re-implements date parsing: they submit
// whatever the user typed, the core normalises it. Returns null when it can't parse (caller
// keeps the user's value rather than losing it).
function normaliseDate(raw) {
  const d = parseDate(raw);
  return d ? formatDate(d) : null;
}

module.exports = { MONTHS, _datePreclean, parseDate, formatDate, normaliseDate };
