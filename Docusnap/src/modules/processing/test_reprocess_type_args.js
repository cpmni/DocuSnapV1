'use strict';
/*
 * resolveReprocessTypeArgs — the pure decision behind the manual type-override on reprocess.
 * Default (no forcedTypeSlug) is byte-identical to the pre-fix handler; a forced dropdown pick that
 * DIFFERS from the stored type forces it as HUMAN authority (no machine title-override, template
 * suppressed). Oracle F2-C1, 2026-07-12.
 *
 * Run:  node src/modules/processing/test_reprocess_type_args.js
 */
const { resolveReprocessTypeArgs } = require('./reprocessTypeArgs');
let fails = 0;
function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  console.log((g === e ? 'OK  ' : 'BAD ') + name + (g === e ? '' : `  got=${g} exp=${e}`));
  if (g !== e) fails++;
}
const SLUGS = new Set(['invoice', 'delivery_note', 'sales_order']);

// ── Default path (no force) — MUST be byte-identical to the pre-fix handler ──────────────────────
eq('no-force + needs_review -> stored + machine authority + linked template',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: null, templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'invoice', authority: 'machine', knownTemplateId: 7 });
eq('no-force + confirmed (status) -> stored + NO authority (human checkpoint) + template',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'confirmed', confirmedAt: null,
                              forcedTypeSlug: null, templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'invoice', authority: null, knownTemplateId: 7 });
eq('no-force + confirmedAt set (auto-filed) -> NO authority even if status not confirmed',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'needs_review', confirmedAt: '2026-07-12',
                              forcedTypeSlug: null, templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'invoice', authority: null, knownTemplateId: 7 });
eq('no-force + no stored slug -> null slug, null authority, template still passed',
   resolveReprocessTypeArgs({ storedSlug: null, status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: null, templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: null, authority: null, knownTemplateId: 7 });

// ── Forced override ──────────────────────────────────────────────────────────────────────────────
eq('force differs + needs_review -> forced, HUMAN (no authority), template SUPPRESSED',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: 'delivery_note', templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'delivery_note', authority: null, knownTemplateId: null });
eq('force differs + CONFIRMED doc -> forced applies (human authority beats the pin)',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'confirmed', confirmedAt: '2026-07-12',
                              forcedTypeSlug: 'delivery_note', templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'delivery_note', authority: null, knownTemplateId: null });
eq('force === stored -> treated as no-force (byte-identical default)',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: 'invoice', templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'invoice', authority: 'machine', knownTemplateId: 7 });
eq('unknown forced slug -> ignored, falls back to stored (a bad slug never nulls the type)',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: 'not_a_type', templateId: 7, knownSlugs: SLUGS }),
   { knownDocSlug: 'invoice', authority: 'machine', knownTemplateId: 7 });
eq('force to a real type from a doc with NO stored type -> forced applies',
   resolveReprocessTypeArgs({ storedSlug: null, status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: 'delivery_note', templateId: null, knownSlugs: SLUGS }),
   { knownDocSlug: 'delivery_note', authority: null, knownTemplateId: null });
eq('knownSlugs absent -> forced accepted (graceful; handler always supplies it, but defend)',
   resolveReprocessTypeArgs({ storedSlug: 'invoice', status: 'needs_review', confirmedAt: null,
                              forcedTypeSlug: 'delivery_note', templateId: 7 }),
   { knownDocSlug: 'delivery_note', authority: null, knownTemplateId: null });

console.log();
console.log(fails ? `${fails} FAILED` : 'All reprocess-type-args checks passed');
process.exit(fails ? 1 : 0);
