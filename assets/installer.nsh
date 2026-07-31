!macro customInstall
  CreateShortCut "$SMPROGRAMS\Khaos Nexus Diagnostics.lnk" "$INSTDIR\Khaos Nexus.exe" "--diagnostics" "$INSTDIR\Khaos Nexus.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Khaos Nexus Diagnostics.lnk"
!macroend
