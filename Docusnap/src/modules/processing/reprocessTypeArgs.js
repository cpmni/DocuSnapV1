'use strict';

/*
 * resolveReprocessTypeArgs — the pure decision for a reprocess's doc-TYPE arguments.
 *
 * Default (no operator override): reproduce today's behaviour byte-identically — pin the doc's STORED
 * type as document_slug, mark it 'machine' authority ONLY when the doc was never human-confirmed (so a
 * trusted contradicting title may re-type it), and pass the doc's linked template as a Stage-0 fallback.
 *
 * Operator override (forcedTypeSlug = the Review dropdown pick, sent only when it DIFFERS from the doc's
 * current type): honour it as HUMAN authority — force that type, withhold 'machine' authority (no title
 * re-type / no snap-back), and SUPPRESS the linked template (it reflects the REJECTED type; the engine's
 * live re-match — the keyword detected_slug fix — recovers the correct-type template, and if it can't the
 * fields fall to Stage 1/2 → empties → review). Persistence + filing are unchanged: the reprocess write-back
 * lands the forced type as needs_review with a "type changed" note, and the doc files only on Confirm.
 *
 * Inputs: storedSlug/status/confirmedAt (the doc row), forcedTypeSlug (payload, may be null), templateId
 * (the doc's linked template, may be null), knownSlugs (Set of valid doc-type slugs; a forcedTypeSlug not
 * in it is ignored — a bad slug can never null the type). Returns {knownDocSlug, authority, knownTemplateId}.
 *
 * Pure + dependency-free so it's unit-testable (test_reprocess_type_args.js). Oracle F2-C1..C4, 2026-07-12.
 */
function resolveReprocessTypeArgs({ storedSlug, status, confirmedAt, forcedTypeSlug, templateId, knownSlugs } = {}) {
  const stored = (storedSlug && String(storedSlug).trim()) ? String(storedSlug).trim() : null;
  const tmpl   = templateId || null;
  const forced = (forcedTypeSlug && String(forcedTypeSlug).trim()) ? String(forcedTypeSlug).trim() : null;
  const forcedIsReal = forced && (!knownSlugs || knownSlugs.has(forced));

  // HUMAN override: only when the pick is a real slug AND actually differs from the stored type
  // (force===stored is a no-op → fall through to the byte-identical default).
  if (forcedIsReal && forced !== stored) {
    return { knownDocSlug: forced, authority: null, knownTemplateId: null };
  }

  // Default path — byte-identical to the pre-fix handler logic.
  const machine = stored && status !== 'confirmed' && !confirmedAt ? 'machine' : null;
  return { knownDocSlug: stored, authority: machine, knownTemplateId: tmpl };
}

module.exports = { resolveReprocessTypeArgs };
