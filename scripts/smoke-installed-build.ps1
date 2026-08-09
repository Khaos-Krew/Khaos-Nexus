param(
  [string]$Installer = "",
  [string]$InstallRoot = "",
  [int]$InstallTimeoutSeconds = 120,
  [int]$UninstallTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

function Wait-BoundedProcess([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds, [string]$Label) {
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
    throw "$Label exceeded the $TimeoutSeconds second timeout."
  }
  $Process.Refresh()
  return $Process.ExitCode
}

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
  $install = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$InstallRoot") -PassThru
  $installExitCode = Wait-BoundedProcess $install $InstallTimeoutSeconds 'Silent installer'
  if ($installExitCode -ne 0) { throw "Silent installer failed with exit code $installExitCode." }
  if (-not (Test-Path -LiteralPath $exe)) { throw "Installed executable is missing: $exe" }

  # This is another PowerShell script, so a terminating error is the failure signal.
  # Do not inspect $LASTEXITCODE here; it belongs to the most recent native process
  # and can retain a stale value even after the PowerShell smoke script succeeds.
  & (Join-Path $PSScriptRoot 'smoke-packaged-startup.ps1') -Executable $exe -SmokeRoot $smokeRoot
  Write-Host 'Clean installer smoke passed.'
} finally {
  $uninstaller = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($uninstaller.Count -gt 0) {
    try {
      $uninstall = Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -PassThru
      $null = Wait-BoundedProcess $uninstall $UninstallTimeoutSeconds 'Silent uninstaller'
    } catch {
      Write-Warning "Silent uninstall cleanup failed: $($_.Exception.Message)"
    }
  }
  Remove-Item -LiteralPath (Split-Path $InstallRoot -Parent) -Recurse -Force -ErrorAction SilentlyContinue
}
