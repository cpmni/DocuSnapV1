; installer.nsh
; Custom NSIS hooks for the ScanFinder Search Client installer/uninstaller.

!macro customInit
  ; Close any running client before INSTALL / REINSTALL so its files aren't locked.
  nsExec::Exec 'taskkill /F /T /IM "ScanFinder Search Client.exe"'
!macroend

!macro customUnInit
  ; Close any running client before UNINSTALL — otherwise the already-running process keeps
  ; living and the app can still be used after the uninstaller "completes".
  nsExec::Exec 'taskkill /F /T /IM "ScanFinder Search Client.exe"'
  Sleep 600
!macroend

!macro customUnInstall
  ; COMPLETE UNINSTALL — optionally remove the client's saved settings (server address, paired
  ; CA, theme, device id). The client stores NO documents. Default NO so a reinstall reconnects
  ; without re-pairing. Skipped during a SILENT uninstall (reinstall/update) so updating keeps them.
  IfSilent keepData 0
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also remove the Search Client's saved settings from this PC?$\r$\n$\r$\nThis clears the saved server address, the trusted certificate and your theme (no documents are stored here). Choose No to keep them for a future reinstall." IDYES removeData IDNO keepData
  removeData:
    RMDir /r "$APPDATA\ScanFinder Search Client"
    RMDir /r "$LOCALAPPDATA\ScanFinder Search Client"
  keepData:
!macroend
