'use strict';
/*
 * Shared "? help mode" for any window.
 *   window.initHelpMode('help-mode-toggle', HELP_TEXTS)
 *
 * Click the "?" toggle → cursor becomes a help cursor and clicking any control
 * shows a short explanation (from HELP_TEXTS keyed by data-help-key) INSTEAD of
 * activating it. Help mode then exits; the popup stays until dismissed (×, Esc,
 * or a click elsewhere). Self-contained, no dependencies, CSP-safe (theme vars).
 */
(function () {
  // Inject the help-mode styles once (uses the window's CSS vars, so it themes).
  if (!document.getElementById('help-mode-style')) {
    const s = document.createElement('style');
    s.id = 'help-mode-style';
    s.textContent = `
      .help-mode, .help-mode * { cursor: help !important; }
      /* On-brand help controls (shared so every window matches; id beats the
         per-window .tb-btn class, so markup keeps its existing class too). */
      .help-guide-btn { display: inline-flex !important; align-items: center; gap: 5px; }
      .help-guide-btn svg { width: 13px; height: 13px; flex: 0 0 auto; stroke: currentColor; }
      #help-mode-toggle {
        width: auto; min-width: 24px; height: 22px; padding: 0 6px;
        border-radius: 5px; border: 1px solid var(--border2);
        background: var(--surface); color: var(--muted);
        font-weight: 600; font-size: 12px; line-height: 1; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        transition: border-color .12s, color .12s, background .12s;
      }
      #help-mode-toggle:hover { border-color: var(--accent); color: var(--accent); }
      #help-mode-toggle.active { border-color: var(--accent); color: var(--accent); background: var(--accent-bg, rgba(79,142,247,.15)); }
      #help-mode-toggle:focus-visible, .help-guide-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .help-popup {
        position: fixed; z-index: 100000; max-width: 280px;
        background: var(--surface); border: 1px solid var(--border2);
        border-radius: 8px; padding: 10px 26px 10px 12px;
        box-shadow: 0 10px 28px rgba(0,0,0,.45);
        font-family: var(--sans, sans-serif); font-size: 12px; color: var(--text); line-height: 1.5;
      }
      .help-popup-x {
        position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
        border: none; background: transparent; color: var(--muted); cursor: pointer;
        font-size: 15px; line-height: 1; border-radius: 4px;
      }
      .help-popup-x:hover { background: var(--surface2); color: var(--text); }
    `;
    document.head.appendChild(s);
  }

  // Copy a control's help-mode explanation into its native `title` so the same
  // description shows on hover, not only via the "?" tool. Fills a gap only — a
  // control with its own curated title keeps it. Interactive controls only, so a
  // hover over a whole panel never pops a tooltip. Runs on the static markup at
  // init; call again after building controls dynamically to cover new ones.
  const TIP_TAGS = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/;
  window.populateHelpTitles = function (texts, root) {
    texts = texts || {};
    try {
      (root || document).querySelectorAll('[data-help-key]').forEach((el) => {
        if (el.id === 'help-mode-toggle') return;
        if (!TIP_TAGS.test(el.tagName)) return;
        if (el.hasAttribute('title') || el.hasAttribute('aria-label')) return;
        const t = texts[el.getAttribute('data-help-key')];
        if (t) el.setAttribute('title', t);
      });
    } catch (_e) { /* tooltips are a nicety — never let this break a window */ }
  };

  window.initHelpMode = function (toggleId, texts) {
    texts = texts || {};
    window.populateHelpTitles(texts);
    const toggle = document.getElementById(toggleId);
    if (!toggle) return;
    let active = false;
    let popup  = null;

    function closePopup() { if (popup) { popup.remove(); popup = null; } }
    function enter() { closePopup(); active = true; document.body.classList.add('help-mode'); toggle.classList.add('active'); }
    function exit()  { active = false; document.body.classList.remove('help-mode'); toggle.classList.remove('active'); closePopup(); }
    // Leave help mode (cursor back to normal) but KEEP the popup until dismissed.
    function softExit() { active = false; document.body.classList.remove('help-mode'); toggle.classList.remove('active'); }

    function showPopup(target, text) {
      closePopup();
      popup = document.createElement('div');
      popup.className = 'help-popup';
      const x = document.createElement('button');
      x.className = 'help-popup-x'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '&times;';
      const body = document.createElement('div');
      body.textContent = text;
      popup.append(x, body);
      document.body.appendChild(popup);

      const r = (target && target.getBoundingClientRect) ? target.getBoundingClientRect() : { left: 20, top: 20, bottom: 40 };
      const pw = popup.offsetWidth, ph = popup.offsetHeight;
      let left = r.left;
      let top  = r.bottom + 8;
      if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
      if (top  + ph > window.innerHeight - 8) top  = r.top - ph - 8;
      popup.style.left = Math.max(8, left) + 'px';
      popup.style.top  = Math.max(8, top)  + 'px';
      x.addEventListener('click', (e) => { e.stopPropagation(); closePopup(); });
    }

    toggle.addEventListener('click', (e) => { e.stopPropagation(); active ? exit() : enter(); });

    // Capture-phase so we intercept BEFORE the control's own click handlers fire.
    document.addEventListener('click', (e) => {
      // Modals/overlays marked data-help-ignore (e.g. a destructive typed-confirm
      // dialog) must stay fully usable even with help mode on — never swallow their
      // clicks, or the user can't focus/type in them.
      const exempt = !!(e.target.closest && e.target.closest('[data-help-ignore]'));
      if (!active) {
        // A popup is showing but help mode is off: an outside click dismisses it
        // (and is consumed) — except a click on the toggle, which re-enters mode,
        // or a click inside an exempt modal, which must reach that modal.
        if (popup && !popup.contains(e.target) && !toggle.contains(e.target)) {
          closePopup();
          if (!exempt) { e.preventDefault(); e.stopPropagation(); }
        }
        return;
      }
      if (exempt || toggle.contains(e.target) || (popup && popup.contains(e.target))) return;
      e.preventDefault(); e.stopPropagation();
      const el   = e.target.closest && e.target.closest('[data-help-key]');
      const text = (el && texts[el.getAttribute('data-help-key')]) ||
                   'No help for this item yet — see the User guide for more.';
      showPopup(el || e.target, text);
      softExit();
    }, true);

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (active || popup)) exit(); });
  };
})();
