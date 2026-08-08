# NATIVE CLASSIC PRINT DIALOG via image-render — design (2026-07-18)

**Status:** MECHANISM PROVEN on the owner's live Win11 + Ricoh Aficio MP C305; DESIGNED, not yet built.
Pending advisor (eric + security) + Oracle gate, then a staged kill-switched build.

## The problem it solves
`webContents.print({silent:false})` on Electron 31 raises **Windows 11's modern print dialog**, whose
preview pane reads *"This app doesn't support print preview"* and whose driver options sit behind
More settings → Printer properties. **KEY FINDING (owner-verified):** that message is **Windows 11's**
modern dialog, NOT an Electron limitation — the same message appears when a .NET app calls the modern
dialog (`PrintDialog.UseEXDialog=$true`, titled "Microsoft Windows Operating System - Print"). No tool
swap escapes it. There is ALSO no permissively-licensed off-the-shelf tool that prints a PDF via a native
dialog (verified: SumatraPDF/MuPDF/Ghostscript/poppler are all GPL/AGPL; commercial SDKs are
$thousands–$tens-of-thousands/yr quote-only). See the research in the session log.

## The proven mechanism
Windows' **CLASSIC** print dialog (`System.Windows.Forms.PrintDialog` with **`UseEXDialog=$false`**) has
**no preview area at all** — so no message — just printer + **Properties** (→ driver booklet/tray/quality)
+ copies + range + collate. `System.Drawing.Printing.PrintDocument` prints IMAGES through the chosen
driver honouring its settings. Both are built into Windows (every PC), reachable from `powershell.exe`
(Windows PowerShell 5.1, always present). Proven with the spike
`scratchpad/print-image-test.ps1` (classic dialog appeared; PDF-free image printing).

## Architecture (all in the CORE main process)
1. **Render** the filed PDF → PNG pages at print DPI (**300** proposed) into a **per-job dir
   `userData/print-jobs/<crypto-random-jobId>/`** (NOT `os.tmpdir` — security: keep it in the app's own
   ACL'd tree like the inbox; render script writes ONLY there; main validates every returned path resolves
   under that dir via `path.resolve(p).startsWith(jobDir)`, the `sweepInboxOrphans` check at main.js:762).
   Reuse `python_backend/render/pages.py` (pypdfium2, BSD). Resolve the source file SERVER-SIDE from the doc
   row (`documents.resolveFilePath`) — the renderer never supplies a path (mirrors the existing
   print/preview boundary). **PAGE CAP** (reuse the Filing-Slips 500-page cap) — refuse absurd page counts
   before rendering (disk/time DoS).
2. **Bundle** a PowerShell script `python_backend/../print/print_images.ps1` (or `src/modules/print/`)
   via `extraResources`; resolve dev-vs-packaged via `app.isPackaged`/`process.resourcesPath` (the
   established pattern; the embeddable-python path-trap lesson applies to the .ps1 too).
3. **Spawn** `powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File <script> --manifest <tmpJson>`
   where the JSON lists the image paths + optional printer hint. **Pass a MANIFEST FILE, not N path args**
   (the project's own Windows ENAMETOOLONG rule — a 50-page doc would blow the command line). Script shows
   the classic dialog; on OK prints each image as a page; emits `PRINTED|CANCELLED|ERROR|VIRTUAL <detail>`
   on stdout. **SPAWN HYGIENE (security):** `spawn('powershell.exe', ['-STA','-NoProfile','-ExecutionPolicy',
   'Bypass','-File', scriptPath, '--manifest', manifestPath])` — argv ARRAY, never a shell string;
   `-NoProfile` (don't run a hostile `$PROFILE` in our STA process); `scriptPath`+`manifestPath` resolved
   ONLY from `process.resourcesPath`/`app.getPath` + a crypto job id, NEVER concatenated with any doc
   name/supplier/renderer string; the `.ps1` reads the manifest with `ConvertFrom-Json` and uses values as
   DATA only — NO `Invoke-Expression`/`iex`/string-built commands.
4. **Audit + cleanup**: the script reports the CHOSEN printer (`$doc.PrinterSettings.PrinterName`) — parse
   stdout → `logAudit('document_printed', outcome, {printer, pages, source})` (success|cancelled|failure;
   printer+port+driver are sanitiser-safe). Then delete the job dir in a `finally` (success/cancel/failure).
   **PLUS (security, required):** a startup **`sweepPrintJobOrphans()`** modeled on `sweepInboxOrphans()`
   (main.js:750) — at launch every job dir is dead, delete them (closes the app-crash-mid-print leak of
   full-res content in userData); AND **kill the child + rm the job dir on `before-quit`** (hook where
   python/watch are stopped, main.js:1214).
   **VIRTUAL-PRINTER / EXFILTRATION CONTROL (owner-raised):** printing to a *file* printer — Microsoft Print
   to PDF (port `PORTPROMPT:`), Microsoft XPS Document Writer, OneNote, Fax, any 3rd-party PDF printer —
   writes a SAVEABLE copy of the document, the same data-control hole as the Edge route. `AllowPrintToFile=
   $false` greys the dialog's "Print to file" checkbox but does NOT stop the user picking a virtual PDF
   printer from the dropdown. **SECURITY VERDICT (folded): audit-always + warn-by-default + admin hard-block.**
   - **Always** audit `printer`+`printer_port`+`driver`+`outcome` (incl. cancels AND file-printer prints →
     `outcome:'printed_to_file'`). Attribution is the real backstop.
   - **Default:** the `.ps1` inspects the chosen printer AFTER the dialog OKs (Name+PortName+DriverName); on
     a DETECTED file/virtual printer (Microsoft Print to PDF `PORTPROMPT:`, XPS Document Writer, OneNote
     `nul:`, Fax "Microsoft Shared Fax Driver", generic `FILE:`/local-file ports) show a confirm ("This
     saves a copy of the document to a file — continue?") and report `VIRTUAL <name>` to main.
   - **Admin hard-block:** setting `restrict_virtual_print` (default OFF) → script refuses a detected file
     printer; ALWAYS refuse for `readonly` seats. Re-check the reported printer name in main against the
     same list (defence in depth, not client-side-only).
   - **Honest scope:** no single OS "is-virtual" flag exists; name+port+driver reliably catches the
     Microsoft set + common PDF printers, but an unknown 3rd-party PDF printer on a TCP-shaped port (or a
     phone camera) is out of scope. DETERRENCE + ATTRIBUTION, not an absolute seal — say so in the help text.
5. **Gate**: a print is a READ → `canAccessDocument` first (Slice-0). Kill switch: existing setting
   `printing_enabled` (default OFF) + env `PRINTING_ENABLED`.

## UI
The Review print **modal stays as the PREVIEW** (the owner liked it) — no Windows dialog shows a preview,
so ours is the only one. Its per-setting controls (copies/duplex/colour/N-up) become REDUNDANT with the
native dialog + Properties → simplify to **preview + a Print button**; Print renders images and raises the
classic dialog which owns all settings. (Keeps the reactive-preview idea moot — settings are chosen in the
native dialog after the preview, the normal Windows model.)

## Fidelity trade-off (honest)
Prints **rasterised pages** (image-based), not vector. For SCANNED docs (already images) this is lossless;
for born-digital PDFs, 300 DPI is good office quality but slightly softer than vector. Accepted trade-off;
revisit with a pdfium+Win32 native helper (BSD, ~2–4 days) only if fidelity ever proves inadequate.

## Booklet
Booklet is DRIVER imposition: with the driver's booklet mode set in Properties, the driver re-orders the
image-pages we send. Should work; VERIFY on the Ricoh (owner test) — it's the one behaviour not yet proven.

## Staging
- **Slice 1**: render→classic-dialog→print + audit + temp cleanup + manifest, behind `printing_enabled`.
  Modal → preview + Print.
- **Slice 2** (optional): silent quick-print to the last/default printer (no dialog) as a fast path.

## Eric review — GO-WITH-CHANGES (folded; packaged-build correctness)
1. **Render is NOT a reuse — `render/pages.py` returns base64 on stdout, writes no files** (pages.py:36-64);
   at 300 DPI (~8× preview pixels) a 50-page doc = hundreds of MB in memory + one giant JSON pipe. **REQUIRED:
   add a streaming `--out-dir <dir> --dpi 300` mode** that renders page→`img.save(page-0001.png)`→release in a
   loop (bounded ~25 MB/page). PNG (lossless, compact, `.NET Image.FromFile` reads natively). Self-contained
   (pypdfium2 is a package — no bare sibling import / sys.path dance).
2. **PACKAGING (the #1 trap): the `.ps1` must be under `python_backend/print/print_images.ps1`, NOT `src/`** —
   `build.files` packs `src/**` into `app.asar` (an external interpreter can't read it → ENOENT only when
   packaged, the embeddable-python class of bug). Under `python_backend/` it rides the EXISTING extraResources
   copy; resolve via `ctx.resourcePath('python_backend','print','print_images.ps1')` (main.js:92-99). No new
   build config.
3. **Spawn (async, tracked, robust):** `spawn` (never exec/shell) the **absolute** interpreter
   `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (not PATH — avoids pwsh shadow/hijack) with
   argv array `['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',script,'-Manifest',
   json]`. **`-Manifest` is SINGLE-dash** (PS binds `-Manifest`; `--manifest` would be a positional and not
   bind). Do NOT `await`/block (unlike today's webContents.print at handler.js:110 — main thread stays free).
   **Track the child PID; kill it on `win.on('closed')` + `app.on('before-quit')`** (taskkill /F /T). Result
   contract = **exit code (0 printed / 2 cancelled / 1 error) as primary + one structured `##RESULT##
   {"outcome","printer","port","driver","pages"}` line** — NOT free-text regex (locale-rots). Timeout on the
   **render** step only (mirror PRINT_LOAD_TIMEOUT_MS handler.js:31); NEVER a kill-timer on the dialog wait
   (a user may legitimately leave it open).
4. **`.ps1` reads the manifest with `[System.IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)`** — NOT
   `Get-Content` (PS 5.1 defaults to ANSI → corrupts an accented `C:\Users\José\…` temp path). Node writes
   UTF-8-no-BOM (good). Confine every manifest path under the job dir before `FromFile`.
5. **windowsHide:true on BOTH spawns** — hides the console, NOT the GUI PrintDialog (verify packaged). Don't
   delete PNGs until the child EXITS (`.NET Image.FromFile` locks until Dispose) — cleanup in the `finally`
   after `close`.
6. **Vehicle:** ship the hardened `.ps1` for Slice 1 but keep the spawn INTERFACE (manifest-in, exit-code +
   `##RESULT##`-out) vehicle-agnostic so a compiled C# `[STAThread]` helper (same WinForms APIs, csc against
   the preinstalled .NET Framework 4.8, still zero third-party licence) is a one-file drop-in IF packaged AV
   telemetry flags the `powershell -ExecutionPolicy Bypass` spawn (a known EDR false-positive magnet on an
   unsigned app). Don't pre-build it.
7. **Modal → preview + ONE Print button** (index.html:1238-1279 / renderer.js:1518-1557): the classic dialog
   owns copies/duplex/colour/N-up/range/printer, so the modal's controls + printer `<select>` +
   `list-printers` become redundant (leave `list-printers` for a future Slice-2 silent quick-print). Keep the
   preview pane. Keep the handler's kill switch + canAccessDocument gate + resolveFilePath + auditPrint
   UNCHANGED — only `printPdf`'s body swaps.

### ⚠ Seam between the two reviews — TEMP LOCATION → ORACLE OVERTURNED to LOCAL temp
Security said `userData/print-jobs/` (thought os temp was "world-shared"); I folded that. **ORACLE: that's a
POSIX mental model — on Windows `app.getPath('temp')` = `%LOCALAPPDATA%\Temp`, PER-USER ACL'd, NOT world-shared,
so the security delta is ~zero; the REAL axis missed is that `userData` = `%APPDATA%\Roaming\ScanFinder` ROAMS —
a crash-orphaned multi-GB 300-DPI render would sync to a domain controller/FSLogix at logoff.** FINAL: write
under **`app.getPath('temp')/ds-print-<cryptoJobId>/`** (LOCAL, non-roaming — the `devSliceDir` pattern the app
already uses for bulky transient content, main.js:983/1218) with security's confinement: crypto job id,
`path.resolve(p).startsWith(jobDir + path.sep)` on every manifest path (the `+ path.sep` is load-bearing —
main.js:1204 does it right), delete in `finally` + `sweepPrintJobOrphans()` at startup (no-op if absent) +
kill-child + rm-dir on before-quit. NEVER `process.resourcesPath` (read-only).

### Packaged-build verify gates (eric — before shipping, on the INSTALLER not npm start)
1. `.ps1` resolves from `resourcesPath` (proves it's not sealed in asar); the classic dialog appears IN FRONT of
   Review; Print succeeds on the Ricoh; **booklet via Properties works** (the one unproven behaviour).
2. 300-DPI streaming render of a **30–50 page** doc under bundled `vendor/python` — no base64/memory blow-up;
   AND **Windows Defender on a CLEAN VM** (not the owner's trusted box) doesn't quarantine the
   `powershell -ExecutionPolicy Bypass` spawn.

## ORACLE — SIGN OFF WITH CONDITIONS (final gate; overturned 2 folds + 1 headline miss)
**THE headline miss (neither specialist caught):** a Group Policy `MachinePolicy`/`UserPolicy` PowerShell
ExecutionPolicy **overrides `-ExecutionPolicy Bypass`** (Microsoft: the flag "does not override policies set by
Group Policy"). In a locked-down org the bundled `.ps1` **silently won't run** — print dies with no output.
Security vetted `-Bypass` for injection, eric for AV; nobody checked whether it even TAKES EFFECT.
- **C1 (temp):** LOCAL `app.getPath('temp')/ds-print-<jobId>/` not roaming userData (see the overturned seam
  above). `startsWith(jobDir + path.sep)`.
- **C2 (vehicle):** ship the **compiled C# `[STAThread]` helper** as Slice 1 (same WinForms PrintDialog +
  PrintDocument, `csc` against preinstalled .NET 4.8, ZERO third-party licence) — GPO-immune (no
  `-ExecutionPolicy` flag) + a much milder EDR heuristic than `powershell -Bypass` on an unsigned app. The
  interface is already vehicle-agnostic (manifest-in / exit-code + `##RESULT##`-out) so it's cheap now. If the
  `.ps1` ships instead, the gate MUST add a GPO-locked VM (ExecutionPolicy=Restricted) proving fail-SAFE + a
  real 3rd-party EDR, not just Defender-clean-VM.
- **C3 (disk DoS):** 500 pages × ~25 MB/page = ~12 GB peak on disk (all pages held until the child exits —
  `Image.FromFile` locks). Add a **free-disk precheck** (`fs.statfsSync`, already used) + a **lower page cap
  for the 300-DPI raster path** (or DPI step-down above N pages) — NOT the raw Filing-Slips 500 cap.
- **C4 (virtual-printer default) — OWNER DECISION:** design defaulted `restrict_virtual_print` OFF (warn-only),
  but that re-opens the saveable-copy hole the owner VETOED for Edge. Fail-safe ⇒ **default ON (block the known
  Microsoft/OneNote/XPS/Fax/`FILE:` set), admin opt-OUT** — unless the owner explicitly ratifies warn-by-default.
  Surface it.
- **C5 (children + audit):** track ALL print children in a **Set** (two rapid clicks = two dialogs); export
  `printModule.killAll()` wired into before-quit (main.js:1209-1221). Distinct audit outcomes **`virtual_declined`**
  (warned→cancelled) and **`virtual_blocked`** (restrict refused), not folded into generic cancelled/failure.
- **C6 (same-commit UI):** the renderer simplification (preview + ONE Print; remove the silent:true button) MUST
  land in the SAME commit as the `printPdf` body-swap, or a half-state leaves the old silent button calling a
  path the new handler dropped. Keep kill-switch + canAccessDocument + resolveFilePath UNCHANGED.
- **C7 (keep vector):** do NOT delete the offscreen-window `webContents.print` path — 300-DPI raster is a
  visible downgrade for a born-digital contract. Repurpose it as a **Slice-2 high-fidelity / silent quick-print
  + a graceful FALLBACK** when the helper fails/is blocked (falls back to the modern dialog, degraded but works).
- **OFF-path:** `sweepPrintJobOrphans()` must `fs.existsSync`-guard (no-op if the dir was never created), run
  unconditionally at startup (cleans orphans from a since-disabled feature). printing_enabled OFF = byte-identical.

**Verify-gate additions (Oracle):** virtual-printer warn/block actually fires on "Microsoft Print to PDF";
readonly blocked from virtual printers AND unconfirmed docs; crash-mid-print orphan swept on relaunch; a manifest
path outside the job dir rejected; OFF = no dir / no spawn; **the GPO-locked-box fail-safe (C2)**.

## Open questions for the gate
- **eric**: spawning `powershell.exe -STA` from main — lifecycle (the dialog is a SEPARATE process, not
  modal to our BrowserWindow — focus/z-order/parent OK?); packaging the `.ps1` in `extraResources` +
  path resolution; AV/SmartScreen exposure of a `powershell -ExecutionPolicy Bypass` spawn; temp-file +
  child-process cleanup on app quit/kill; manifest-file vs args; is a `.ps1` the right vehicle vs a
  tiny bundled `.exe`/`.cs` compiled via `csc`?
- **security**: `-ExecutionPolicy Bypass` on OUR bundled read-only script — acceptable? Injection surface
  (manifest paths are app-generated temp paths, not user input — but validate/confine to the temp dir);
  the transient on-disk images (deleted post-print) vs the data-control model (canAccessDocument + no
  saveable copy leaves the app) — does this preserve the exfiltration posture the client's PNG-only
  boundary established? Any way a crafted doc/path escapes the temp confinement? Audit completeness
  (cancel + failure rows).
- **both**: is `.ps1` acceptable long-term, or bundle a small compiled helper to avoid the PowerShell
  execution-policy / AV surface entirely (still no third-party licence — it'd be our own code + .NET)?
