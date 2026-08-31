@echo off
rem Full realdoc A/B for the LIGHT-TEXT pass on the healed live-DB copy, AT THE APP'S DPI (Oracle C6: the harness never
rem mirrors _ocrDpiEnv — OCR_RENDER_DPI=200 is exported here and echoed into both logs). OFF = no light env, ON = 1.
set ELECTRON_RUN_AS_NODE=1
set RR_APP_ENV=1
set OCR_RENDER_DPI=200
set S=C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\9ba057d0-eb41-4ae9-9865-83e53e7ddadb\scratchpad
cd /d "c:\GIT Projects\Docusnap"
set E=c:\GIT Projects\Docusnap\node_modules\electron\dist\electron.exe
set RR_DB=%S%\rr_req_on.db
set OCR_LIGHT_TEXT_RECOVERY=
set RR_CONSENSUS=%S%\rr_light_off.jsonl
set RR_DUMP=%S%\rr_light_off_dump.jsonl
set RR_TYPE_ENUM=%S%\rr_light_off_type.jsonl
echo OCR_RENDER_DPI=%OCR_RENDER_DPI% OCR_LIGHT_TEXT_RECOVERY=%OCR_LIGHT_TEXT_RECOVERY% > "%S%\rr_light_off.out"
"%E%" stress_test\realdoc_regression.js >> "%S%\rr_light_off.out" 2>&1
set OCR_LIGHT_TEXT_RECOVERY=1
set RR_CONSENSUS=%S%\rr_light_on.jsonl
set RR_DUMP=%S%\rr_light_on_dump.jsonl
set RR_TYPE_ENUM=%S%\rr_light_on_type.jsonl
echo OCR_RENDER_DPI=%OCR_RENDER_DPI% OCR_LIGHT_TEXT_RECOVERY=%OCR_LIGHT_TEXT_RECOVERY% > "%S%\rr_light_on.out"
"%E%" stress_test\realdoc_regression.js >> "%S%\rr_light_on.out" 2>&1
echo DONE > "%S%\rr_light_done.flag"
