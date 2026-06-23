; installer.nsh
; Custom NSIS hooks for ScanFinder installer
; This ensures the application is properly installed and shortcuts created

!macro customInstall
  ; NOTE: do NOT pre-create the %APPDATA% data folder here. The app creates its
  ; own userData folder (%APPDATA%\ScanFinder) on first launch and performs a
  ; one-time migration from the legacy %APPDATA%\DocuSnap folder (see src/main.js).
  ; Pre-creating an empty ScanFinder folder would defeat that migration and orphan
  ; existing installs' data.

  ; Write registry entries so Windows recognises the app
  WriteRegStr HKCU "Software\ScanFinder" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\ScanFinder" "Version" "2.0.0"
!macroend

!macro customUnInstall
  ; Clean up registry on uninstall (current + legacy brand key)
  DeleteRegKey HKCU "Software\ScanFinder"
  DeleteRegKey HKCU "Software\DocuSnap"
!macroend
