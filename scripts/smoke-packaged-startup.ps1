param(
  [string]$Executable = "dist/win-unpacked/Khaos Nexus.exe",
  [int]$ReadyTimeoutSeconds = 95,
  [int]$WindowTimeoutSeconds = 25
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = Resolve-Path -LiteralPath $Executable
$smokeRoot = Join-Path $PWD '.packaged-startup-smoke'
$roaming = Join-Path $smokeRoot 'AppData/Roaming'
$local = Join-Path $smokeRoot 'AppData/Local'
$temp = Join-Path $smokeRoot 'Temp'
$evidence = Join-Path $smokeRoot 'startup-health.json'

Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $roaming, $local, $temp | Out-Null

$previous = @{
  APPDATA = $env:APPDATA
  LOCALAPPDATA = $env:LOCALAPPDATA
  TEMP = $env:TEMP
  TMP = $env:TMP
  KHAOS_PACKAGED_STARTUP_SMOKE = $env:KHAOS_PACKAGED_STARTUP_SMOKE
  KHAOS_PACKAGED_STARTUP_SMOKE_FILE = $env:KHAOS_PACKAGED_STARTUP_SMOKE_FILE
}

$process = $null
$lastState = $null
try {
  $env:APPDATA = $roaming
  $env:LOCALAPPDATA = $local
  $env:TEMP = $temp
  $env:TMP = $temp
  $env:KHAOS_PACKAGED_STARTUP_SMOKE = '1'
  $env:KHAOS_PACKAGED_STARTUP_SMOKE_FILE = $evidence

  $process = Start-Process -FilePath $resolvedExecutable -ArgumentList @('--disable-gpu') -PassThru
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $windowDeadline = (Get-Date).AddSeconds($WindowTimeoutSeconds)
  $sawWindow = $false

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
      throw "Packaged Khaos Nexus exited during startup with code $($process.ExitCode)."
    }
    if ($process.MainWindowHandle -ne 0) { $sawWindow = $true }
    if (-not $sawWindow -and (Get-Date) -gt $windowDeadline) {
      throw 'Packaged Khaos Nexus did not expose a startup window within the allowed time.'
    }

    if (-not (Test-Path -LiteralPath $evidence)) { continue }
    try {
      $payload = Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json
      $lastState = $payload.state
    } catch {
      continue
    }

    $phase = [string]$lastState.phase
    $overall = [string]$lastState.overall
    if ($lastState.limitedMode -eq $true -or $phase -eq 'limited-mode' -or $phase -eq 'needs-attention' -or $overall -eq 'failed') {
      $failedChecks = @($lastState.checks | Where-Object { $_.status -eq 'fail' } | ForEach-Object { "$($_.id): $($_.detail)" })
      throw "Packaged Khaos Nexus did not reach full startup readiness. Phase=$phase Overall=$overall Failures=$($failedChecks -join ' | ')"
    }

    $fullyReady = (
      $phase -eq 'ready' -and
      $lastState.released -eq $true -and
      $lastState.completed -eq $true -and
      $lastState.releaseAllowed -eq $true -and
      $lastState.limitedMode -ne $true -and
      $lastState.rendererBridgeReady -eq $true -and
      $lastState.rendererModulesReady -eq $true -and
      $lastState.configStoreReady -eq $true
    )
    if ($fullyReady) {
      if (-not $sawWindow) { throw 'Full readiness was reported without a visible application window.' }
      Write-Host "Packaged startup readiness passed: PID $($process.Id), phase=$phase, limitedMode=false."
      return
    }
  }

  $summary = if ($lastState) { $lastState | ConvertTo-Json -Depth 8 -Compress } else { 'No startup-health evidence was produced.' }
  throw "Packaged Khaos Nexus did not reach phase=ready within $ReadyTimeoutSeconds seconds. Last state: $summary"
} finally {
  if ($process -and -not $process.HasExited) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Warning "Packaged startup process cleanup was incomplete after validation: $($_.Exception.Message)"
    }
  }
  foreach ($name in $previous.Keys) {
    if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $previous[$name] }
  }
  Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
