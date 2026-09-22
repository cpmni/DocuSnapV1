$ErrorActionPreference = 'Continue'
Set-Location 'C:\GIT Projects\Docusnap'
$out = 'C:\GIT Projects\Docusnap\stress_test\out'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:RR_APP_ENV = '1'

# OFF arm (tonight's code, class F dark)
Remove-Item "$out\rr_f_off.jsonl","$out\rr_f_off_dump.jsonl" -ErrorAction SilentlyContinue
$env:CORROB_VERIFICATION_DOUBT_CLEAR = '0'
$env:RR_CONSENSUS = "$out\rr_f_off.jsonl"
$env:RR_DUMP = "$out\rr_f_off_dump.jsonl"
& .\node_modules\.bin\electron.cmd stress_test\realdoc_regression.js *> "$out\rr_f_off.log"
Copy-Item "$out\realdoc_regression.md" "$out\rr_f_off.md" -Force

# ON arm (class F armed)
Remove-Item "$out\rr_f_on.jsonl","$out\rr_f_on_dump.jsonl" -ErrorAction SilentlyContinue
$env:CORROB_VERIFICATION_DOUBT_CLEAR = '1'
$env:RR_CONSENSUS = "$out\rr_f_on.jsonl"
$env:RR_DUMP = "$out\rr_f_on_dump.jsonl"
& .\node_modules\.bin\electron.cmd stress_test\realdoc_regression.js *> "$out\rr_f_on.log"
Copy-Item "$out\realdoc_regression.md" "$out\rr_f_on.md" -Force

(Get-Date).ToString('s') | Out-File "$out\rr_f_done.txt"
