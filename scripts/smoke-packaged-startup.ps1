param(
  [string]$Executable = "dist/win-unpacked/Khaos Nexus.exe",
  [int]$MinimumAliveSeconds = 40,
  [int]$WindowTimeoutSeconds = 25
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = Resolve-Path -LiteralPath $Executable
$smokeRoot = Join-Path $PWD '.packaged-startup-smoke'
$roaming = Join-Path $smokeRoot 'AppData/Roaming'
$local = Join-Path $smokeRoot 'AppData/Local'
$temp = Join-Path $smokeRoot 'Temp'

Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $roaming, $local, $temp | Out-Null

$previous = @{
  APPDATA = $env:APPDATA
  LOCALAPPDATA = $env:LOCALAPPDATA
  TEMP = $env:TEMP
  TMP = $env:TMP
}

$process = $null
try {
  $env:APPDATA = $roaming
  $env:LOCALAPPDATA = $local
  $env:TEMP = $temp
  $env:TMP = $temp
  $env:KHAOS_PACKAGED_STARTUP_SMOKE = '1'

  $process = Start-Process -FilePath $resolvedExecutable -ArgumentList @('--disable-gpu') -PassThru
  $deadline = (Get-Date).AddSeconds($MinimumAliveSeconds)
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
  }

  if (-not $sawWindow) { throw 'Packaged Khaos Nexus never exposed a startup window.' }
  Write-Host "Packaged startup smoke passed: PID $($process.Id) remained alive for $MinimumAliveSeconds seconds and exposed a window."
} finally {
  if ($process -and -not $process.HasExited) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
  Remove-Item Env:KHAOS_PACKAGED_STARTUP_SMOKE -ErrorAction SilentlyContinue
  foreach ($name in $previous.Keys) {
    if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $previous[$name] }
  }
  Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
