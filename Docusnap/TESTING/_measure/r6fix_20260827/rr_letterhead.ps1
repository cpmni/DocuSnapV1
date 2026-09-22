$ErrorActionPreference = 'Continue'
Set-Location 'C:\GIT Projects\Docusnap'
$out = 'C:\GIT Projects\Docusnap\stress_test\out'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:RR_APP_ENV = '1'

# OFF arm (today's code, letterhead scope dark) — env '0' is explicit so the arm is pinned, not inherited
Remove-Item "$out\rr_lh_off.jsonl","$out\rr_lh_off_dump.jsonl" -ErrorAction SilentlyContinue
$env:TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE = '0'
$env:RR_CONSENSUS = "$out\rr_lh_off.jsonl"
$env:RR_DUMP = "$out\rr_lh_off_dump.jsonl"
& .\node_modules\.bin\electron.cmd stress_test\realdoc_regression.js *> "$out\rr_lh_off.log"
Copy-Item "$out\realdoc_regression.md" "$out\rr_lh_off.md" -Force

# ON arm (letterhead scope armed)
Remove-Item "$out\rr_lh_on.jsonl","$out\rr_lh_on_dump.jsonl" -ErrorAction SilentlyContinue
$env:TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE = '1'
$env:RR_CONSENSUS = "$out\rr_lh_on.jsonl"
$env:RR_DUMP = "$out\rr_lh_on_dump.jsonl"
& .\node_modules\.bin\electron.cmd stress_test\realdoc_regression.js *> "$out\rr_lh_on.log"
Copy-Item "$out\realdoc_regression.md" "$out\rr_lh_on.md" -Force

(Get-Date).ToString('s') | Out-File "$out\rr_lh_done.txt"
