param(
  [Parameter(Mandatory = $true)]
  [string]$Transaction
)

$ErrorActionPreference = 'Stop'

function Write-Result {
  param(
    [string]$Status,
    [string]$Reason = ''
  )
  $payload = [ordered]@{
    status = $Status
    fromVersion = $tx.currentVersion
    toVersion = $tx.targetVersion
    reason = $Reason
    at = [DateTime]::UtcNow.ToString('o')
  }
  $directory = Split-Path -Parent $tx.resultPath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $tx.resultPath -Encoding UTF8
}

function Relative-Path {
  param([string]$Root, [string]$FullName)
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $fullPath = [IO.Path]::GetFullPath($FullName)
  if (-not $fullPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escaped staged update root: $FullName"
  }
  return $fullPath.Substring($rootPath.Length)
}

function Backup-StagedTargets {
  param([string]$StagedDir, [string]$TargetDir, [string]$BackupDir)
  Remove-Item -LiteralPath $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  $entries = @()
  foreach ($file in Get-ChildItem -LiteralPath $StagedDir -File -Recurse) {
    $relative = Relative-Path -Root $StagedDir -FullName $file.FullName
    $destination = Join-Path $TargetDir $relative
    $backup = Join-Path $BackupDir $relative
    $existed = Test-Path -LiteralPath $destination -PathType Leaf
    if ($existed) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
      Copy-Item -LiteralPath $destination -Destination $backup -Force
    }
    $entries += [ordered]@{ relative = $relative; existed = $existed }
  }
  $entries | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $BackupDir 'rollback-files.json') -Encoding UTF8
}

function Apply-StagedPayload {
  param([string]$StagedDir, [string]$TargetDir)
  foreach ($file in Get-ChildItem -LiteralPath $StagedDir -File -Recurse) {
    $relative = Relative-Path -Root $StagedDir -FullName $file.FullName
    $destination = Join-Path $TargetDir $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  }
}

function Restore-Backup {
  param([string]$TargetDir, [string]$BackupDir)
  $manifestPath = Join-Path $BackupDir 'rollback-files.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { return }
  $entries = @(Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
  foreach ($entry in $entries) {
    $destination = Join-Path $TargetDir $entry.relative
    $backup = Join-Path $BackupDir $entry.relative
    if ($entry.existed -eq $true) {
      if (Test-Path -LiteralPath $backup -PathType Leaf) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $backup -Destination $destination -Force
      }
    } else {
      Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    }
  }
}

function Wait-For-Exit {
  param([int]$ProcessId, [int]$TimeoutSeconds = 60)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

$transactionPath = [IO.Path]::GetFullPath($Transaction)
$tx = Get-Content -LiteralPath $transactionPath -Raw | ConvertFrom-Json

$targetDir = [IO.Path]::GetFullPath([string]$tx.targetDir)
$stagedDir = [IO.Path]::GetFullPath([string]$tx.stagedDir)
$backupDir = [IO.Path]::GetFullPath([string]$tx.backupDir)
$markerPath = [IO.Path]::GetFullPath([string]$tx.markerPath)
$executablePath = Join-Path $targetDir ([string]$tx.executableName)
$startupTimeout = [Math]::Max(15, [int]$tx.startupTimeoutSeconds)

if (-not (Test-Path -LiteralPath $stagedDir -PathType Container)) { throw 'Staged update directory is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $stagedDir ([string]$tx.executableName)) -PathType Leaf)) { throw 'Staged update executable is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $stagedDir 'resources\app.asar') -PathType Leaf)) { throw 'Staged update app.asar is missing.' }

$rollbackNeeded = $false
$newProcess = $null

try {
  if (-not (Wait-For-Exit -ProcessId ([int]$tx.pid) -TimeoutSeconds 60)) {
    throw 'Nexus did not exit in time for the staged update.'
  }

  Backup-StagedTargets -StagedDir $stagedDir -TargetDir $targetDir -BackupDir $backupDir
  $rollbackNeeded = $true
  Apply-StagedPayload -StagedDir $stagedDir -TargetDir $targetDir

  Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
  $quotedTransaction = '"' + $transactionPath + '"'
  $newProcess = Start-Process -FilePath $executablePath -ArgumentList @('--nexus-post-update', $quotedTransaction) -WorkingDirectory $targetDir -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds($startupTimeout)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
      $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
      if ($marker.ok -eq $true -and [string]$marker.version -eq [string]$tx.targetVersion) {
        Write-Result -Status 'success'
        exit 0
      }
    }
    if ($newProcess.HasExited) { break }
    Start-Sleep -Milliseconds 300
  }

  throw 'Updated Nexus did not confirm a healthy startup before the rollback deadline.'
}
catch {
  $reason = [string]$_.Exception.Message
  try {
    if ($newProcess -and -not $newProcess.HasExited) { Stop-Process -Id $newProcess.Id -Force -ErrorAction SilentlyContinue }
  } catch {}

  if ($rollbackNeeded) {
    try { Restore-Backup -TargetDir $targetDir -BackupDir $backupDir } catch { $reason += " Rollback restore error: $($_.Exception.Message)" }
  }

  Write-Result -Status 'rolled-back' -Reason $reason
  try {
    Start-Process -FilePath $executablePath -ArgumentList @('--nexus-update-rollback', [string]$tx.targetVersion) -WorkingDirectory $targetDir | Out-Null
  } catch {}
  exit 1
}
