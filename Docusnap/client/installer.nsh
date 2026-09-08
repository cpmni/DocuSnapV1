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
    ; Under a per-machine install the uninstaller runs with SetShellVarContext all (electron-builder
    ; multiUser.nsh setInstallModePerAllUsers), where $APPDATA / $LOCALAPPDATA resolve to C:\ProgramData
    ; — NOT the user's profile — so this wipe silently targeted folders that do not exist (owner report
    ; on the per-machine CORE app 2026-09-07: "remove all data" left %APPDATA%\ScanFinder behind; the client
    ; inherits the same trap the moment it installs per-machine, so the flip ships with the guard).
    ; Electron data is ALWAYS per-user: switch to the current user's context for the wipe and restore
    ; the all-users context afterwards (electron-builder's own uninstaller.nsh does exactly this around
    ; its $APPDATA wipe). Harmless under a per-user install ($installMode != all).
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    RMDir /r "$APPDATA\ScanFinder Search Client"
    RMDir /r "$LOCALAPPDATA\ScanFinder Search Client"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  keepData:
!macroend
