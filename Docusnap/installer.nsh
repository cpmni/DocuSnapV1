; installer.nsh
; Custom NSIS hooks for DocuSnap installer
; This ensures the application is properly installed and shortcuts created

!macro customInstall
  ; Create the application data directory
  CreateDirectory "$APPDATA\DocuSnap"
  
  ; Write registry entries so Windows recognises the app
  WriteRegStr HKCU "Software\DocuSnap" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\DocuSnap" "Version" "2.0.0"
!macroend

!macro customUnInstall
  ; Clean up registry on uninstall
  DeleteRegKey HKCU "Software\DocuSnap"
!macroend
