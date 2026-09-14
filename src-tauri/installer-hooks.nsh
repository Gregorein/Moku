!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM tsunagu.exe /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM Moku.exe /T'
  Pop $0
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM tsunagu.exe /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM Moku.exe /T'
  Pop $0
  Sleep 500
!macroend
