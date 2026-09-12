#!/usr/bin/env bash
# OFF-vs-ON flip gate for DESKEW_RETRY_FIELD_ADOPT (mig 162, 2026-09-12; Oracle C11).
# Cells (each = OFF arm + ON arm + diff):
#   armed : RR_APP_ENV=1 — the app's spawn env mirrored from the DB (on the owner's armed dev DB that means
#           mig 153 template_taught_corrob_adopt ON, template_pad_window_code ON, DESKEW_CORROB_AUTOFILE ON, …).
#           The new key is absent from a DB that never ran mig 162, so the explicit env value passes through the
#           `{...process.env, ...appEnv}` spread untouched (appEnv only SETS keys it finds 'true').
#   base  : RR_APP_ENV=0 (arm137 baseline, NO dark switch) + DESKEW_REVIEW_RETRY=1 (the parent, ON live) — the
#           mig-153-OFF cell the Oracle requires (the exhibit class is VACUOUS here by design; M=0 + set-equality
#           must still hold).
# OCR_RENDER_DPI=200 in every arm (product DPI). The ONE explicit env var is the only OFF/ON difference.
# Harness = stress_test/realdoc_regression.js over the DB's CONFIRMED docs (live DB read-only, or RR_DB=<copy>;
# the 605 corpus needs RR_DB pointed at a DB that holds it — REQUIRED by C11 before any flip).
# Census: RR_LOG_MATCH/RR_LOG_OUT capture the Straighten+reread log lines per doc → door census (passes, note-door
# passes) + fire census (FIELD-ADOPTED lines, to be adjudicated AT THE PIXELS).
set -u
cd "$(dirname "$0")/../../.." || exit 1
REPO="$(pwd)"
OUTDIR="$REPO/stress_test/out/deskew_field_adopt_20260912"
mkdir -p "$OUTDIR"
ELECTRON="./node_modules/electron/dist/electron.exe"
HARNESS="stress_test/realdoc_regression.js"
ENVVAR="DESKEW_RETRY_FIELD_ADOPT"
DIFF="TESTING/_measure/flip_census_20260911/diff_consensus.js"

DBP="${RR_DB:-$APPDATA/ScanFinder/docusnap.db}"
PARENT=$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON" -e "const D=require('./node_modules/better-sqlite3');const db=new D(process.argv[1],{readonly:true});const r=db.prepare(\"SELECT value FROM settings WHERE key='deskew_review_retry_enabled'\").get();console.log(r?r.value:'');db.close()" "$DBP" 2>/dev/null | tail -1)

census () {                                       # $1 = the straighten log dump
  ELECTRON_RUN_AS_NODE=1 "$ELECTRON" -e "
const fs=require('fs');const f=process.argv[1];if(!fs.existsSync(f)){console.log('  (no straighten lines captured)');process.exit(0)}
let pass=0,note=0,fire=[],adopted=0;const docs=new Set();
for(const ln of fs.readFileSync(f,'utf8').split('\n')){if(!ln.trim())continue;let o;try{o=JSON.parse(ln)}catch{continue}
 const t=o.text||'';if(/page skew .* re-reading straightened/.test(t)){pass++;docs.add(o.doc)}
 if(/note-only hold/.test(t))note++; if(/: ADOPTED \(overall/.test(t))adopted++;
 if(/FIELD-ADOPTED/.test(t))fire.push(o.doc+' :: '+t.replace(/^\s*Straighten\+reread: /,''))}
console.log('  door census: straighten passes='+pass+' on '+docs.size+' doc(s); note-door passes='+note+'; whole-doc adopts='+adopted);
console.log('  FIRE census (field adopts): '+fire.length);fire.slice(0,40).forEach(x=>console.log('    '+x));" "$1"
}

run_arm () {                                      # $1=cell $2=off|on $3=envval
  local cell="$1" arm="$2" val="$3"
  local dump="$OUTDIR/${cell}_${arm}.consensus.jsonl" log="$OUTDIR/${cell}_${arm}.log" slog="$OUTDIR/${cell}_${arm}.straighten.jsonl"
  rm -f "$dump" "$slog"
  echo "=== CELL $cell ARM $arm : $ENVVAR=$val -> $dump"
  if [ "$cell" = "armed" ]; then
    env RR_APP_ENV=1 RR_ALLOW_ARMED=1 OCR_RENDER_DPI=200 "$ENVVAR=$val" RR_CONSENSUS="$dump" \
        RR_LOG_MATCH='Straighten\+reread' RR_LOG_OUT="$slog" \
        ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$HARNESS" > "$log" 2>&1
  else
    env RR_APP_ENV=0 RR_ALLOW_ARMED=1 OCR_RENDER_DPI=200 DESKEW_REVIEW_RETRY=1 "$ENVVAR=$val" RR_CONSENSUS="$dump" \
        RR_LOG_MATCH='Straighten\+reread' RR_LOG_OUT="$slog" \
        ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$HARNESS" > "$log" 2>&1
  fi
  grep -iE "operating point|silent|wrong|auto-file|M=" "$log" | tail -6
  census "$slog"
}

cell () {                                         # $1=armed|base
  if [ "$1" = "armed" ] && [ "$PARENT" != "true" ]; then
    echo "REFUSED: deskew_review_retry_enabled='$PARENT' in $DBP — the armed cell would be vacuous (retry never runs)." >&2; return 3
  fi
  run_arm "$1" off 0
  run_arm "$1" on 1
  echo "--- CELL $1: OFF vs ON diff (M + filer-set) ---"
  ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$DIFF" "$OUTDIR/$1_off.consensus.jsonl" "$OUTDIR/$1_on.consensus.jsonl"
}

case "${1:-all}" in
  armed|base) cell "$1" ;;
  all) cell armed; echo; cell base ;;
  *) echo "usage: run_gate.sh [armed|base|all]"; exit 2 ;;
esac
