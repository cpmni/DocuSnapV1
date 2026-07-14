(function (root) {
  'use strict';

  // Disambiguation picker (⑂ Resolve) — the ONE convention conversion, isolated so it is
  // node-testable and can't silently flip (Oracle G2, the one silent-learning-corruption risk).
  //
  // The candidate `box` is emitted TOP-LEFT normalised (the picker contract, anchor.py _norm_box_dict);
  // `field_anchors` stores the value CENTRE (renderer captureAnchorContext stores x = rect.x + rect.w/2).
  // A picked-candidate anchor must therefore convert TOP-LEFT → CENTRE exactly ONCE, here — feeding a
  // top-left box straight into the CENTRE-convention store would shift every learned position by half a
  // box. This is pure arithmetic on the RAW normalised box, so it is independent of any display/deskew
  // state (the direct stage never touches the preview frame).
  //
  // Returns {x_norm, y_norm, w_norm, h_norm} in the CENTRE convention, or null on a bad/empty box.
  function pickBoxToAnchorCentre(box) {
    if (!box) return null;
    const x = +box.x_norm, y = +box.y_norm, w = +box.w_norm, h = +box.h_norm;
    if (!(w > 0) || !(h > 0) || Number.isNaN(x) || Number.isNaN(y)) return null;
    return { x_norm: x + w / 2, y_norm: y + h / 2, w_norm: w, h_norm: h };
  }

  root.PickBox = { pickBoxToAnchorCentre };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.PickBox).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).PickBox;
}
