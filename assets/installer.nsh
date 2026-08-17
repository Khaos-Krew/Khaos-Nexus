!macro customInstall
  CreateShortCut "$SMPROGRAMS\Nexus D&D Diagnostics.lnk" "$INSTDIR\Nexus D&D.exe" "--diagnostics" "$INSTDIR\Nexus D&D.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Nexus D&D Diagnostics.lnk"
!macroend