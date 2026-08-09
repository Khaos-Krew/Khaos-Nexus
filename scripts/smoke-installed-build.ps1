param(
  [string]$Installer = "",
  [string]$InstallRoot = ""
)

$ErrorActionPreference = 'Stop'
if (-not $Installer) {
  $candidate = @(Get-ChildItem -LiteralPath 'dist' -Filter 'Khaos-Nexus-Setup-*-x64.exe' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
  if ($candidate.Count -eq 0) { throw 'No candidate Khaos Nexus installer found under dist.' }
  $Installer = $candidate[0].FullName
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
if (-not $InstallRoot) { $InstallRoot = Join-Path $PWD '.installed-build-smoke/Program' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$smokeRoot = Join-Path $PWD '.installed-build-smoke/Startup'
$exe = Join-Path $InstallRoot 'Khaos Nexus.exe'

Remove-Item -LiteralPath (Split-Path $InstallRoot -Parent) -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

try {
  Write-Host "Installing clean candidate: $Installer"
  $install = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$InstallRoot") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "Silent installer failed with exit code $($install.ExitCode)." }
  if (-not (Test-Path -LiteralPath $exe)) { throw "Installed executable is missing: $exe" }

  & (Join-Path $PSScriptRoot 'smoke-packaged-startup.ps1') -Executable $exe -SmokeRoot $smokeRoot
  if ($LASTEXITCODE -ne 0) { throw 'Installed application startup smoke failed.' }
  Write-Host 'Clean installer smoke passed.'
} finally {
  $uninstaller = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($uninstaller.Count -gt 0) {
    try { Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -Wait | Out-Null } catch { Write-Warning "Silent uninstall cleanup failed: $($_.Exception.Message)" }
  }
  Remove-Item -LiteralPath (Split-Path $InstallRoot -Parent) -Recurse -Force -ErrorAction SilentlyContinue
}
