'use strict';
/*
 * identifierExtract.js — JS TWIN of python_backend/extraction/identifier_extract.py (slice 1a of the
 * identifier-registry arc). The confirm-time LEARN (learning.saveSupplierIdentifiers) runs this over a
 * confirmed doc's stored ocr_text; the Python twin runs at extraction time for the slice-1b match path.
 * Parity-pinned (the VAT mod-97 checksum + the field set). Keep the two in lockstep.
 *
 * Identity keys (VAT / company_no) are matched EXACTLY on the normalised value — never a fuzzy fold: the
 * VAT checksum IS the confusable detector, and a fold would "repair" a misread into a valid-but-DIFFERENT
 * number that falsely corroborates the wrong company (Oracle + reggie, 2026-08-26).
 */

// UK VAT mod-97 checksum — EXACT twin of trust.js _validVatGb (and identifier_extract.valid_vat_gb).
function validVatGb(v) {
  const up = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  if (/^GB(GD|HA)\d{3}$/.test(up)) return true;
  const s = up.replace(/[^0-9]/g, '');
  if (!/^\d{9}(\d{3})?$/.test(s)) return false;
  const d = s.slice(0, 9).split('').map(Number);
  const w = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += d[i] * w[i];
  const check = d[7] * 10 + d[8];
  return (sum + check) % 97 === 0 || (sum + check + 55) % 97 === 0;
}

const RE_VAT_CAND = /\bGB\s*\d(?:[\d\s]{7,16})\d\b/ig;
const RE_VAT_DIGITS = /(?<!\d)(\d{3}[ ]?\d{4}[ ]?\d{2}(?:[ ]?\d{3})?)(?!\d)/g;
const RE_VAT_CAPTION = /\bV\.?\s?A\.?\s?T\.?\b/i;
const RE_COMPANY_CAPTION = /\b(?:company\s*(?:reg(?:istration)?\.?\s*)?(?:no|number)|reg(?:istered)?\.?\s*(?:no|number)|registered\s+in\s+england(?:\s+and\s+wales)?(?:\s+(?:no|number))?|co\.?\s*reg(?:\.?\s*no)?)\b/i;
const RE_COMPANY_NUM = /\b((?:SC|NI|OC|SO|NC|FC|GE|IP|SP|RS|R0|RC)\s?\d{6}|\d{6,8})\b/ig;
const RE_COMPANY_CANON = /^(?:\d{8}|(?:SC|NI|OC|SO|NC|FC|GE|IP|SP|RS|R0|RC)\d{6})$/;
const RE_PHONE_CAPTION = /\b(?:tel|telephone|phone|mob(?:ile)?|call\s+us)\b[:.]?/i;
const RE_FAX_CAPTION = /\bfax\b[:.]?/i;
const RE_PHONE = /(?:\+44\s?\(?0?\)?|\(?0)(?:[\d\s\-)]{8,13})\d/g;
const RE_MONEY = /[£$€¥]|\d[.,]\d{2}(?!\d)/;
const RE_SELF_ID = /\b(?:V\.?A\.?T\.?\s*(?:reg|registration|no|number)|registered\s+in\s+england|registered\s+(?:office|number|no)|company\s*(?:reg|no|number))\b/i;
const RE_RECIPIENT = /\b(?:bill\s*to|ship\s*to|sold\s*to|deliver(?:ed)?\s*to|invoice\s*to|customer|client)\b/i;

function normAlnum(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
function vatNorm(raw) {
  const up = normAlnum(raw);
  if (/^GB(GD|HA)\d{3}$/.test(up)) return up;
  const digits = up.replace(/[^0-9]/g, '');
  return (digits.length === 9 || digits.length === 12) ? 'GB' + digits : up;
}
function companyNorm(raw) {
  const up = normAlnum(raw);
  if (/^(?:SC|NI|OC|SO|NC|FC|GE|IP|SP|RS|R0|RC)\d{6}$/.test(up)) return up;
  const digits = up.replace(/[^0-9]/g, '');
  return (digits.length >= 6 && digits.length <= 8) ? digits.padStart(8, '0') : up;
}
function phoneNorm(raw) {
  let d = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
  if (d.startsWith('0044')) d = '0' + d.slice(4);
  else if (d.startsWith('44') && d.length >= 11) d = '0' + d.slice(2);
  return d;
}
function regionOf(idx, nLines, firstRecipientIdx) {
  if (firstRecipientIdx != null && idx >= firstRecipientIdx && idx < nLines - 5) return 'body';
  if (idx < Math.min(8, Math.max(1, Math.floor(nLines / 3)))) return 'header';
  if (idx >= nLines - 6) return 'footer';
  return 'body';
}

// → array of identifier records (twin of the Python contract). Pure, over the page text.
function extractIdentifiers(ocrText) {
  const lines = String(ocrText == null ? '' : ocrText).split('\n').map(l => l.replace(/\s+$/, ''));
  const n = lines.length;
  let firstRecipient = null;
  for (let i = 0; i < n; i++) { if (RE_RECIPIENT.test(lines[i])) { firstRecipient = i; break; } }
  const out = [];
  const add = (kind, raw, valueNorm, checksumPassed, entropy, caption, idx, line) => {
    const region = regionOf(idx, n, firstRecipient);
    out.push({
      kind, raw, value_norm: valueNorm, valid: true, checksum_passed: checksumPassed, entropy, caption,
      position: {
        line_index: idx, region,
        self_id_caption: RE_SELF_ID.test(line),
        near_recipient_marker: !!(firstRecipient != null && idx >= firstRecipient && region !== 'footer'),
        line_text: line.trim(),
      },
    });
  };
  for (let i = 0; i < n; i++) {
    const ln = lines[i];
    const hasMoney = RE_MONEY.test(ln);
    // VAT
    const cands = [];
    let m;
    RE_VAT_CAND.lastIndex = 0;
    while ((m = RE_VAT_CAND.exec(ln))) cands.push(m[0]);
    if (RE_VAT_CAPTION.test(ln)) { RE_VAT_DIGITS.lastIndex = 0; while ((m = RE_VAT_DIGITS.exec(ln))) cands.push(m[1]); }
    const seen = new Set();
    for (const raw of cands) {
      const vn = vatNorm(raw);
      if (seen.has(vn)) continue;
      seen.add(vn);
      const ck = validVatGb(vn);
      const gdHa = /^GB(GD|HA)\d{3}$/.test(vn);
      if (hasMoney && !ck) continue;
      if (!(ck || gdHa)) continue;
      add('vat', raw, vn, gdHa ? null : true, (ck && !gdHa) ? 'decisive' : 'strong',
          RE_VAT_CAPTION.test(ln) ? 'vat' : null, i, ln);
    }
    // company number — caption-gated
    if (RE_COMPANY_CAPTION.test(ln) && !RE_VAT_CAPTION.test(ln)) {
      RE_COMPANY_NUM.lastIndex = 0;
      while ((m = RE_COMPANY_NUM.exec(ln))) {
        const cn = companyNorm(m[1]);
        if (RE_COMPANY_CANON.test(cn)) add('company_no', m[1], cn, null, 'strong', 'company_no', i, ln);
      }
    }
    // phone (supporting) — captioned, fax excluded
    if (RE_PHONE_CAPTION.test(ln) && !RE_FAX_CAPTION.test(ln)) {
      RE_PHONE.lastIndex = 0;
      while ((m = RE_PHONE.exec(ln))) {
        const pn = phoneNorm(m[0]);
        if (/^0\d{9,10}$/.test(pn)) add('phone', m[0], pn, null, 'supporting', 'phone', i, ln);
      }
    }
  }
  return out;
}

module.exports = { validVatGb, extractIdentifiers };
