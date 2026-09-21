#!/usr/bin/env bash
# Flip census 2026-09-21 @ HEAD (mig 198). Baseline OFF (RR_APP_ENV=1), then TWO union arms over the 400
# test docs. Lever = SHELL ENV (uppercase key); RR_APP_ENV=1 keeps DARK keys 'false' in DB so the shell
# value survives (no clobber). Sequential (shared CPU).
#   HEAL   = every still-OFF reading/reference/date/geometry/restriction switch ON together
#            (expect M=0; changes only file->hold or a correct heal).
#   FRICTION = the 3 auto-file looseners ON together (eyeball every new auto-file; bar = 0 wrong auto-files).
# EXCLUDED (logged, not censused): format_class_join (blast radius), segment_pair_hold (needs C12 + is
#   segmentation, inert on single-doc realdoc), deskew_corrob_autofile (owner's call).
set -u
cd "c:/GIT Projects/Docusnap"
DIR="TESTING/_measure/flip_census_20260921"
exec > "$DIR/census_run.out" 2>&1   # self-redirect (Start-Process stdout capture is unreliable on this box)
echo "SCRIPT STARTED $(date)"
rm -f "$DIR/CENSUS_DONE.flag"
IDS="$(cat "$DIR/rr_ids_700.txt")"
DB="$DIR/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"

HEAL_ENV=(
  FORMAT_VARIANCE_RELAX TEMPLATE_FRAGMENT_CONTAINMENT_YIELD TEMPLATE_LOCATE_ROLE_QUALIFIER
  FORMAT_VARIANCE_RELAX_REF FORMAT_VARIANCE_RELAX_REF_INLINE FILING_SANITY_REF_CORROB_SOFTEN
  RESOLVE_REF_NEAR_MISS RESOLVE_REF_POSITIONAL FILING_SANITY_REF_HISTORY_SOFTEN
  ANCHOR_BARE_LABEL_FUZZY ANCHOR_LABELLESS_CURRENCY_REFUSE TYPE_UNINSTALLED_HEADING_FOLD
  CONFUSION_PRECEDENCE BUYER_ISSUED_CONVENTION_ONE_CONFIRM TEACH_ANGLE_COMPOSE_NULL_ABSTAIN
  TEMPLATE_DATE_LEFT_CLIP_GROW TEMPLATE_PAD_DATE_CONTAINMENT_FLAG TEMPLATE_CLIP_COMMIT_LEFT_SLACK
  INLINE_DISAGREE_CORROB_SOFTEN TEMPLATE_NAME_GROW_BAND_PICK TEMPLATE_NAME_CUT_DEFER_CAP
  KEYWORD_SUPERSTRING_NAME_NOTE TEMPLATE_CODE_READ_WIDEN TYPE_SPLIT_TEACH_SCOPE_SUPPRESS
  SWEEP_INVIEW_RECHECK TEMPLATE_EDGE_CLIP_HEAL ROLE_DISAGREE_REFUSE_AT100 TEMPLATE_TAUGHT_CORROB_ADOPT
  ANCHOR_AXIS_LOCK FILING_SANITY_REF_REINSTATE TEMPLATE_CODE_LEFT_GROW DESKEW_RETRY_FIELD_ADOPT
  DESKEW_FALSE_ABSENT_REFLAG TEMPLATE_DATE_INVALID_YIELD_LOWCONF DATE_FORMS_WIDE
  ISSUER_UNDETECTED_BLANK REF_BADGE_VERIFY_STATE
)
FRICTION_ENV=( OPTIONAL_SOFT_FLAG_AUTOFILE CORROB_AUTOFILE_BAND88 FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE )

run_arm() {  # name  env-array-name|-
  local NAME="$1"; shift
  local OUT="$DIR/${NAME}.jsonl" LOG="$DIR/${NAME}.log"
  rm -f "$OUT"
  local -a ENVSET=()
  for v in "$@"; do ENVSET+=("$v=1"); done
  echo "=== $NAME (${#ENVSET[@]} switches) start $(date +%H:%M:%S)"
  env "${ENVSET[@]}" RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 \
      RR_CONSENSUS="$OUT" TESS="$TESS" \
      ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
}

run_arm base_env1
run_arm heal_on "${HEAL_ENV[@]}"
run_arm friction_on "${FRICTION_ENV[@]}"
echo "CENSUS DONE $(date +%H:%M:%S)"
touch "$DIR/CENSUS_DONE.flag"
