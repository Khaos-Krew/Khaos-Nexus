param(
  [string]$PreviousTag = "",
  [string]$CandidateInstaller = "",
  [string]$InstallRoot = ""
)

$ErrorActionPreference = 'Stop'
$p = Get-Content package.json -Raw | ConvertFrom-Json
if (-not $PreviousTag) { $PreviousTag = [string]$p.khaosRelease.rollbackTag }
if (-not $PreviousTag) { throw 'PreviousTag was not provided and package.json has no khaosRelease.rollbackTag.' }
if (-not $CandidateInstaller) {
  $candidate = @(Get-ChildItem -LiteralPath 'dist' -Filter 'Khaos-Nexus-Setup-*-x64.exe' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
  if ($candidate.Count -eq 0) { throw 'No candidate Khaos Nexus installer found under dist.' }
  $CandidateInstaller = $candidate[0].FullName
}
$CandidateInstaller = (Resolve-Path -LiteralPath $CandidateInstaller).Path
if (-not $InstallRoot) { $InstallRoot = Join-Path $PWD '.upgrade-smoke/Program' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$root = Split-Path $InstallRoot -Parent
$download = Join-Path $root 'Previous'
$session = Join-Path $root 'Session'
$exe = Join-Path $InstallRoot 'Khaos Nexus.exe'
$previousVersion = $PreviousTag -replace '^v', ''
$previousName = "Khaos-Nexus-Setup-$previousVersion-x64.exe"
$previousInstaller = Join-Path $download $previousName
$marker = Join-Path $session 'AppData/Roaming/Khaos Nexus/upgrade-smoke-owner-marker.json'

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $download, $InstallRoot | Out-Null

try {
  Write-Host "Downloading previous public installer $PreviousTag / $previousName"
  gh release download $PreviousTag --repo $env:GITHUB_REPOSITORY --pattern $previousName --dir $download --clobber
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $previousInstaller)) { throw "Unable to download previous installer for $PreviousTag." }

  $installPrevious = Start-Process -FilePath $previousInstaller -ArgumentList @('/S', "/D=$InstallRoot") -Wait -PassThru
  if ($installPrevious.ExitCode -ne 0) { throw "Previous installer failed with exit code $($installPrevious.ExitCode)." }
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Previous installed executable is missing.' }

  & (Join-Path $PSScriptRoot 'smoke-packaged-startup.ps1') -Executable $exe -SmokeRoot $session -KeepSmokeRoot
  if ($LASTEXITCODE -ne 0) { throw 'Previous release startup smoke failed.' }

  New-Item -ItemType Directory -Force -Path (Split-Path $marker -Parent) | Out-Null
  [pscustomobject]@{ previousTag = $PreviousTag; preserved = $true } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding utf8

  Write-Host "Installing candidate over $PreviousTag using the same install root."
  $installCandidate = Start-Process -FilePath $CandidateInstaller -ArgumentList @('/S', "/D=$InstallRoot") -Wait -PassThru
  if ($installCandidate.ExitCode -ne 0) { throw "Candidate upgrade installer failed with exit code $($installCandidate.ExitCode)." }
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Candidate installed executable is missing after upgrade.' }

  & (Join-Path $PSScriptRoot 'smoke-packaged-startup.ps1') -Executable $exe -SmokeRoot $session -ReuseSmokeRoot -KeepSmokeRoot
  if ($LASTEXITCODE -ne 0) { throw 'Upgraded release startup smoke failed.' }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Isolated user-data preservation marker was lost during upgrade.' }

  Write-Host "Upgrade smoke passed: $PreviousTag -> candidate; startup and isolated user data survived."
} finally {
  $uninstaller = @(Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($uninstaller.Count -gt 0) {
    try { Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -Wait | Out-Null } catch { Write-Warning "Silent uninstall cleanup failed: $($_.Exception.Message)" }
  }
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
