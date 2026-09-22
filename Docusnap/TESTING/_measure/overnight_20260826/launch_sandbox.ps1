$ErrorActionPreference = 'Continue'
Set-Location 'C:\GIT Projects\Docusnap'
$sb = "C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\18994421-2524-48d2-a00f-9f1a01116677\scratchpad\chris-sandbox"
$env:DOCUSNAP_USERDATA = "$sb\userData"
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start -- --remote-debugging-port=9223 *> "$sb\app.log"
