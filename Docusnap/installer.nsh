; installer.nsh
; Custom NSIS hooks for the ScanFinder installer/uninstaller.

; SafeWipe — RMDir /r a data folder ONLY if it does not equal or contain the user's chosen
; output/documents folder ($R0, read from HKCU\Software\ScanFinder\OutputPath). The output
; folder normally sits well outside the app-data folders, so filed documents are never touched;
; this guards the edge case where a user pointed their output folder INSIDE one. A prefix match
; is intentionally cautious — if in any doubt we KEEP the folder rather than risk the user's
; documents. `Uid` gives each expansion unique labels. StrCmp is case-insensitive (Windows paths).
!macro SafeWipe Dir Uid
  StrCmp $R0 "" wipe_${Uid} 0        ; no recorded output path -> nothing to protect, just wipe
  StrLen $R1 "${Dir}"
  StrCpy $R2 $R0 $R1                  ; first StrLen(Dir) chars of the output path
  StrCmp $R2 "${Dir}" skip_${Uid} wipe_${Uid}
  skip_${Uid}:
    DetailPrint "Kept ${Dir} — it contains your documents folder"
    Goto done_${Uid}
  wipe_${Uid}:
    RMDir /r "${Dir}"
  done_${Uid}:
!macroend

!macro customInit
  ; Close any running ScanFinder before INSTALL / REINSTALL so its files (and the bundled
  ; Python/Tesseract child processes it spawns) aren't locked. /T kills the whole tree.
  nsExec::Exec 'taskkill /F /T /IM ScanFinder.exe'
!macroend

!macro customUnInit
  ; Close any running ScanFinder before UNINSTALL. Without this the already-running process
  ; keeps living (and its on-disk exe stays locked), so the uninstaller "completes" yet the
  ; app can still be opened and used. /T also stops its python/tesseract children.
  nsExec::Exec 'taskkill /F /T /IM ScanFinder.exe'
  Sleep 600
!macroend

!macro customInstall
  ; NOTE: do NOT pre-create the %APPDATA% data folder here. The app creates its own userData
  ; folder (%APPDATA%\ScanFinder) on first launch and performs a one-time migration from the
  ; legacy %APPDATA%\DocuSnap folder (see src/main.js). Pre-creating an empty ScanFinder folder
  ; would defeat that migration and orphan existing installs' data.

  ; Write registry entries so Windows recognises the app
  WriteRegStr HKCU "Software\ScanFinder" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\ScanFinder" "Version" "2.0.0"
!macroend

!macro customUnInstall
  ; Read the user's recorded output/documents folder BEFORE deleting the brand key (the key
  ; holds OutputPath). Empty on installs that never launched / never set an output folder.
  ReadRegStr $R0 HKCU "Software\ScanFinder" "OutputPath"

  ; Clean up registry on uninstall (current + legacy brand key)
  DeleteRegKey HKCU "Software\ScanFinder"
  DeleteRegKey HKCU "Software\DocuSnap"

  ; COMPLETE UNINSTALL — optionally remove ALL user data: the documents database, settings,
  ; learned data (anchors/templates/corrections), inbox working copies, TLS certs and the
  ; licensing/trial state. Default is NO (keep it) so a future reinstall resumes where it left
  ; off. SKIPPED during a SILENT uninstall (e.g. the auto-uninstall an installer runs before a
  ; reinstall/update) so updating never wipes the user's data.
  ;
  ; Your FILED documents live in your chosen output folder (default: Documents\Scan Finder),
  ; which is separate from these app-data folders and is NEVER deleted here. SafeWipe adds a
  ; belt-and-braces guard so even an output folder placed INSIDE an app-data folder is preserved.
  IfSilent keepData 0
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also remove all ScanFinder data from this PC?$\r$\n$\r$\nThis permanently deletes the ScanFinder database, your settings and learned data, and any not-yet-filed documents still in the review queue.$\r$\n$\r$\nYour FILED documents in your output folder are NOT affected and stay on your PC.$\r$\n$\r$\nChoose No to keep everything for a future reinstall." IDYES removeData IDNO keepData
  removeData:
    !insertmacro SafeWipe "$APPDATA\ScanFinder"      a
    !insertmacro SafeWipe "$APPDATA\DocuSnap"         b
    !insertmacro SafeWipe "$LOCALAPPDATA\ScanFinder"  c
  keepData:
!macroend
