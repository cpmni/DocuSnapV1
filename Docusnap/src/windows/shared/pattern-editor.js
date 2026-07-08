'use strict';
// ── Visual pattern editor ────────────────────────────────────────────────────────
// A contenteditable field that renders each KNOWN {token} as an atomic, friendly
// PILL ("Issuer", "Year", "Month"…) while separators and any custom text stay as
// normal typed characters between the pills. It serialises back to the exact
// "{token}/…" pattern string the backend already understands — so it is a pure UI
// swap for the old raw-text pattern <input> used by the first-run wizard's
// "How should filed documents be organised?" step and Settings → Output Structure.
//
// WHY: the raw "{supplier}/{year}/{month}" text read as CODE to first-run users
// (curly braces + slashes + monospace). Pills remove that impression without
// changing the stored value, the preview, or any IPC.
//
// Usage:
//   const ed = window.createPatternEditor(hostEl, {
//     tokens: [{ token:'{supplier}', label:'Document Issuer', short:'Issuer' }, …],
//     onChange: (patternStr) => { … },          // fires on every user edit
//     placeholder: 'Click a block below, or type…',
//   });
//   ed.setValue('{supplier}/{year}/{month}');   // string → pills (no onChange)
//   ed.getValue();                              // pills → string
//   ed.insertToken('{year}');                   // insert a pill at the caret
//
// Self-contained: injects its own stylesheet once, keyed to the ambient theme.css
// CSS variables, so it matches every theme. No external assets → CSP-safe.

(function () {
  const STYLE_ID = 'pe-styles';
  const TOKEN_RE = /\{[a-zA-Z_]+\}/g;
  const NBSP_RE  = / /g;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // Inline flow (NOT flex) on the editable root — a flex contenteditable turns each
    // text run into an anonymous flex item and makes the caret misbehave; inline pills
    // wrap and place the caret exactly like a normal text field.
    s.textContent = [
      '.pe-field{display:block;min-height:44px;padding:7px 10px;border:1px solid var(--border2);',
      '  border-radius:var(--r-sm,9px);background:var(--surface);color:var(--text);',
      "  font-family:'IBM Plex Sans',-apple-system,Segoe UI,sans-serif;font-size:14px;",
      '  line-height:2;cursor:text;outline:none;overflow-wrap:anywhere;',
      '  transition:border-color .12s,box-shadow .12s}',
      '.pe-field:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}',
      '.pe-field.pe-empty::before{content:attr(data-placeholder);color:var(--muted);pointer-events:none}',
      '.pe-pill{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;vertical-align:middle;',
      '  margin:0 1px;background:var(--accent-bg);color:var(--accent2);border-radius:6px;',
      '  padding:2px 3px 2px 9px;font-size:12.5px;font-weight:600;user-select:none}',
      '.pe-pill .pe-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;',
      '  border-radius:4px;font-size:14px;line-height:1;color:var(--accent2);opacity:.5;cursor:pointer}',
      '.pe-pill .pe-x:hover{opacity:1;background:rgba(128,128,128,.25)}',
      // Palette "add a block" chips (rendered by the host page next to the field).
      '.pe-chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none;',
      '  -webkit-app-region:no-drag;background:var(--surface2);border:1px solid var(--border2);',
      '  border-radius:var(--r-pill,999px);padding:4px 12px;font-size:12.5px;font-weight:500;',
      '  color:var(--text);transition:border-color .12s,background .12s,color .12s}',
      '.pe-chip:hover{border-color:var(--accent);color:var(--accent2);background:var(--accent-bg)}',
      ".pe-chip::before{content:'+';font-weight:700;color:var(--accent2);opacity:.75}",
    ].join('\n');
    document.head.appendChild(s);
  }

  function createPatternEditor(el, opts) {
    opts = opts || {};
    ensureStyles();
    const meta = {};                                  // token -> { label, short, … }
    for (const t of (opts.tokens || [])) meta[t.token] = t;

    el.classList.add('pe-field');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('role', 'textbox');
    el.setAttribute('spellcheck', 'false');
    if (opts.placeholder) el.setAttribute('data-placeholder', opts.placeholder);
    if (opts.ariaLabel)   el.setAttribute('aria-label', opts.ariaLabel);

    let savedRange = null;                            // last caret position inside the field

    function makePill(token) {
      const m = meta[token];
      const pill = document.createElement('span');
      pill.className = 'pe-pill';
      pill.setAttribute('contenteditable', 'false');  // atomic — the caret skips over it
      pill.dataset.token = token;
      pill.title = (m && m.label) || token;
      const lbl = document.createElement('span');
      lbl.textContent = (m && (m.short || m.label)) || token;
      const x = document.createElement('span');
      x.className = 'pe-x'; x.textContent = '×'; x.title = 'Remove';
      pill.appendChild(lbl); pill.appendChild(x);
      return pill;
    }

    // pills → pattern string (the ONLY value the backend sees).
    function serialize() {
      let out = '';
      el.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList && node.classList.contains('pe-pill')) out += node.dataset.token || '';
          else if (node.tagName !== 'BR') out += node.textContent || '';   // stray element → its text
        }
      });
      return out.replace(NBSP_RE, ' ');            // contenteditable emits nbsp for typed spaces
    }

    function updateEmpty() { el.classList.toggle('pe-empty', serialize() === ''); }

    function emitChange() {
      updateEmpty();
      if (typeof opts.onChange === 'function') opts.onChange(serialize());
    }

    // pattern string → pills. Programmatic — does NOT fire onChange.
    function render(pattern) {
      el.textContent = '';
      const str = String(pattern == null ? '' : pattern);
      let last = 0, m; TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(str))) {
        if (m.index > last) el.appendChild(document.createTextNode(str.slice(last, m.index)));
        // Known token → pill; unknown {foo} → keep literal text so it round-trips exactly.
        el.appendChild(meta[m[0]] ? makePill(m[0]) : document.createTextNode(m[0]));
        last = m.index + m[0].length;
      }
      if (last < str.length) el.appendChild(document.createTextNode(str.slice(last)));
      updateEmpty();
    }

    function rememberRange() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (el.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
      }
    }
    function placeCaret(range) {
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      savedRange = range.cloneRange();
    }

    function insertToken(token) {
      const pill = makePill(token);
      let range = (savedRange && el.contains(savedRange.commonAncestorContainer))
        ? savedRange.cloneRange() : null;
      if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
      range.deleteContents();
      range.insertNode(pill);
      range.setStartAfter(pill); range.collapse(true);
      el.focus();
      placeCaret(range);
      emitChange();
    }

    function removePill(pill) {
      const range = document.createRange();
      range.setStartBefore(pill); range.collapse(true);
      pill.remove();
      el.focus();
      placeCaret(range);
      emitChange();
    }

    // × click — mousedown+preventDefault so the browser doesn't first move the caret.
    el.addEventListener('mousedown', (e) => {
      const x = e.target && e.target.closest && e.target.closest('.pe-x');
      if (x) { e.preventDefault(); const p = x.closest('.pe-pill'); if (p) removePill(p); }
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); return; }              // single line
      if (e.key === 'Backspace') {                                        // delete the pill before the caret
        const sel = window.getSelection();
        if (!sel.isCollapsed || !sel.rangeCount) return;
        const r = sel.getRangeAt(0);
        let before = null;
        if (r.startContainer === el) before = el.childNodes[r.startOffset - 1] || null;
        else if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset === 0)
          before = r.startContainer.previousSibling;
        if (before && before.nodeType === Node.ELEMENT_NODE &&
            before.classList && before.classList.contains('pe-pill')) {
          e.preventDefault(); removePill(before);
        }
      }
    });

    // Plain-text paste only — strip rich formatting and newlines (single line).
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (((e.clipboardData || window.clipboardData).getData('text/plain')) || '')
        .replace(/[\r\n]+/g, ' ');
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0); r.deleteContents();
        const tn = document.createTextNode(text);
        r.insertNode(tn); r.setStartAfter(tn); r.collapse(true);
        placeCaret(r);
      }
      emitChange();
    });

    el.addEventListener('input',   emitChange);
    el.addEventListener('keyup',   rememberRange);
    el.addEventListener('mouseup', rememberRange);
    el.addEventListener('blur',    rememberRange);

    return {
      element:  el,
      getValue: serialize,
      setValue: render,
      insertToken,
      focus: () => el.focus(),
    };
  }

  window.createPatternEditor = createPatternEditor;
})();
