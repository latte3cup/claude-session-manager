!macro NSIS_HOOK_PREINSTALL
  ; Kill backend process before install/upgrade
  nsExec::ExecToLog 'taskkill /f /im remote-code-server.exe'
  nsExec::ExecToLog 'taskkill /f /im remote-code-desktop.exe'
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Kill backend process before uninstall
  nsExec::ExecToLog 'taskkill /f /im remote-code-server.exe'
  nsExec::ExecToLog 'taskkill /f /im remote-code-desktop.exe'
  Sleep 1000
!macroend
