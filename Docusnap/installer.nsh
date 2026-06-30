; installer.nsh
; Custom NSIS hooks for the ScanFinder installer/uninstaller.

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
  ; Clean up registry on uninstall (current + legacy brand key)
  DeleteRegKey HKCU "Software\ScanFinder"
  DeleteRegKey HKCU "Software\DocuSnap"

  ; COMPLETE UNINSTALL — optionally remove ALL user data: the documents database, settings,
  ; learned data (anchors/templates/corrections), inbox working copies, TLS certs and the
  ; licensing/trial state. Default is NO (keep it) so a future reinstall resumes where it left
  ; off. SKIPPED during a SILENT uninstall (e.g. the auto-uninstall an installer runs before a
  ; reinstall/update) so updating never wipes the user's data.
  IfSilent keepData 0
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also remove all ScanFinder data from this PC?$\r$\n$\r$\nThis permanently deletes your documents database, settings, learned data, inbox working copies and the licensing/trial state. Choose No to keep them for a future reinstall." IDYES removeData IDNO keepData
  removeData:
    RMDir /r "$APPDATA\ScanFinder"
    RMDir /r "$APPDATA\DocuSnap"
    RMDir /r "$LOCALAPPDATA\ScanFinder"
  keepData:
!macroend
