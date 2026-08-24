param(
  [string]$DistDir = 'dist',
  [string]$UpdaterScript = 'src/updater/apply-update.ps1'
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Path))
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
  }
  finally { $stream.Dispose() }
}

function Wait-For-File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$TimeoutSeconds = 45
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Read-SmokeResult {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Wait-For-File -Path $Path -TimeoutSeconds 45)) { throw "Smoke result was not created: $Path" }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Stop-NexusProcessesFromInstall {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)
  $full = [IO.Path]::GetFullPath($ExecutablePath)
  Get-CimInstance Win32_Process -Filter "Name='Khaos Nexus.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ([string]$_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $full) {
      Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue
    }
  }
}

$package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$version = [string]$package.version
if (-not $version) { throw 'package.json has no version.' }

$dist = [IO.Path]::GetFullPath($DistDir)
$installer = Join-Path $dist "Khaos-Nexus-$version-Setup.exe"
$stagedDir = Join-Path $dist 'win-unpacked'
$updater = [IO.Path]::GetFullPath($UpdaterScript)
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer missing: $installer" }
if (-not (Test-Path -LiteralPath $stagedDir -PathType Container)) { throw "Staged Windows payload missing: $stagedDir" }
if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) { throw "Updater helper missing: $updater" }

$runRoot = Join-Path $env:RUNNER_TEMP ("nexus-windows-smoke-" + [Guid]::NewGuid().ToString('N'))
$installDir = Join-Path $runRoot 'install'
$userData = Join-Path $runRoot 'userdata'
$cleanResultPath = Join-Path $runRoot 'clean-start.json'
$upgradeResultPath = Join-Path $runRoot 'upgrade-start.json'
$rollbackDir = Join-Path $runRoot 'rollback'
$reportPath = Join-Path $dist 'nexus-windows-smoke-report.json'
New-Item -ItemType Directory -Path $runRoot, $installDir, $userData -Force | Out-Null

$oldSmoke = $env:NEXUS_CI_SMOKE
$oldUserData = $env:NEXUS_CI_USER_DATA
$oldResult = $env:NEXUS_CI_SMOKE_RESULT

try {
  Write-Host "Installing Khaos Nexus $version into isolated smoke directory."
  $installProcess = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($installProcess.ExitCode -ne 0) { throw "NSIS clean install exited with code $($installProcess.ExitCode)." }

  $installedExe = Join-Path $installDir 'Khaos Nexus.exe'
  $installedAsar = Join-Path $installDir 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw 'Clean install did not create Khaos Nexus.exe.' }
  if (-not (Test-Path -LiteralPath $installedAsar -PathType Leaf)) { throw 'Clean install did not create resources/app.asar.' }

  $env:NEXUS_CI_SMOKE = '1'
  $env:NEXUS_CI_USER_DATA = $userData
  $env:NEXUS_CI_SMOKE_RESULT = $cleanResultPath
  Remove-Item -LiteralPath $cleanResultPath -Force -ErrorAction SilentlyContinue

  $cleanProcess = Start-Process -FilePath $installedExe -WorkingDirectory $installDir -PassThru
  if (-not $cleanProcess.WaitForExit(45000)) {
    Stop-Process -Id $cleanProcess.Id -Force -ErrorAction SilentlyContinue
    throw 'Clean-installed Nexus did not exit its CI smoke harness in time.'
  }
  if ($cleanProcess.ExitCode -ne 0) { throw "Clean-installed Nexus smoke exited with code $($cleanProcess.ExitCode)." }
  $clean = Read-SmokeResult -Path $cleanResultPath
  if ($clean.ok -ne $true) { throw "Clean-install smoke failed: $($clean.error)" }
  if ($clean.packaged -ne $true) { throw 'Clean-install smoke did not run as a packaged Electron app.' }
  if ([string]$clean.version -ne $version) { throw "Clean-install smoke version '$($clean.version)' did not match '$version'." }
  if ($clean.backend.ok -ne $true) { throw 'Clean-install smoke did not prove embedded backend health.' }

  Stop-NexusProcessesFromInstall -ExecutablePath $installedExe

  $transactionDir = Join-Path $userData "updates\transactions\$version"
  $transactionPath = Join-Path $transactionDir 'transaction.json'
  $markerPath = Join-Path $transactionDir 'startup-ok.json'
  $lastResultPath = Join-Path $userData 'updates\last-result.json'
  New-Item -ItemType Directory -Path $transactionDir -Force | Out-Null
  Remove-Item -LiteralPath $markerPath, $lastResultPath, $upgradeResultPath -Force -ErrorAction SilentlyContinue

  $transaction = [ordered]@{
    schemaVersion = 1
    pid = 2147483647
    currentVersion = '0.0.0-smoke'
    targetVersion = $version
    targetDir = $installDir
    stagedDir = $stagedDir
    backupDir = $rollbackDir
    executableName = 'Khaos Nexus.exe'
    markerPath = $markerPath
    resultPath = $lastResultPath
    startupTimeoutSeconds = 45
  }
  $transaction | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $transactionPath -Encoding UTF8

  $env:NEXUS_CI_SMOKE_RESULT = $upgradeResultPath
  Write-Host 'Applying staged update through the production updater helper.'
  $updateProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $updater, '-Transaction', $transactionPath
  ) -WorkingDirectory (Get-Location).Path -Wait -PassThru
  if ($updateProcess.ExitCode -ne 0) {
    $resultText = if (Test-Path -LiteralPath $lastResultPath) { Get-Content -LiteralPath $lastResultPath -Raw } else { 'no updater result' }
    throw "Staged updater smoke exited with code $($updateProcess.ExitCode): $resultText"
  }

  $upgrade = Read-SmokeResult -Path $upgradeResultPath
  $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  $updaterResult = Get-Content -LiteralPath $lastResultPath -Raw | ConvertFrom-Json
  if ($upgrade.ok -ne $true) { throw "Staged-upgrade app smoke failed: $($upgrade.error)" }
  if ($upgrade.packaged -ne $true) { throw 'Staged-upgrade smoke did not run as a packaged Electron app.' }
  if ([string]$upgrade.version -ne $version) { throw "Staged-upgrade smoke version '$($upgrade.version)' did not match '$version'." }
  if ($upgrade.backend.ok -ne $true) { throw 'Staged-upgrade smoke did not prove embedded backend health.' }
  if ($upgrade.postUpdate.required -ne $true -or $upgrade.postUpdate.confirmed -ne $true) { throw 'Updated app did not observe its post-update health confirmation marker.' }
  if ($marker.ok -ne $true -or [string]$marker.version -ne $version) { throw 'Updater startup marker is invalid.' }
  if ([string]$updaterResult.status -ne 'success') { throw "Updater transaction result was '$($updaterResult.status)', not success." }

  $stagedAsar = Join-Path $stagedDir 'resources\app.asar'
  $installedAsarHash = Get-Sha256Hex -Path $installedAsar
  $stagedAsarHash = Get-Sha256Hex -Path $stagedAsar
  if ($installedAsarHash -ne $stagedAsarHash) { throw 'Installed app.asar does not match the validated staged update payload after apply.' }

  $report = [ordered]@{
    schemaVersion = 1
    product = 'khaos-nexus'
    version = $version
    cleanInstall = [ordered]@{
      ok = $true
      packaged = $true
      backendHealthy = $true
    }
    stagedUpgrade = [ordered]@{
      ok = $true
      packaged = $true
      backendHealthy = $true
      postUpdateConfirmed = $true
      resultStatus = [string]$updaterResult.status
    }
    payload = [ordered]@{
      installedAsarSha256 = $installedAsarHash
      stagedAsarSha256 = $stagedAsarHash
      matches = $true
    }
    generatedAt = [DateTime]::UtcNow.ToString('o')
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Host "Windows clean-install + staged-upgrade smoke passed: $reportPath"
}
finally {
  try { Stop-NexusProcessesFromInstall -ExecutablePath (Join-Path $installDir 'Khaos Nexus.exe') } catch {}
  $env:NEXUS_CI_SMOKE = $oldSmoke
  $env:NEXUS_CI_USER_DATA = $oldUserData
  $env:NEXUS_CI_SMOKE_RESULT = $oldResult
  Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
}
