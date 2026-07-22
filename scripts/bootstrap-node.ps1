[CmdletBinding()]
param(
  [int]$MinimumMajor = 22,
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$runtimeRoot = Join-Path $ProjectRoot '.runtime'
$pathFile = Join-Path $runtimeRoot 'node-path.txt'
$cacheRoot = Join-Path $runtimeRoot 'downloads'

function Write-Step([string]$Message) {
  Write-Host "[Node Setup] $Message"
}

function Get-NodeMajor([string]$NodeExecutable) {
  try {
    $major = & $NodeExecutable -p "Number(process.versions.node.split('.')[0])" 2>$null
    if ($LASTEXITCODE -eq 0 -and $major -match '^\d+$') { return [int]$major }
  } catch {}
  return 0
}

function Get-SystemNode {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command node -ErrorAction SilentlyContinue }
  if (-not $command) { return $null }
  if ((Get-NodeMajor $command.Source) -lt $MinimumMajor) { return $null }
  return (Split-Path -Parent $command.Source)
}

function Get-CachedNode {
  if (-not (Test-Path -LiteralPath $pathFile)) { return $null }
  $candidate = (Get-Content -LiteralPath $pathFile -Raw).Trim()
  if (-not $candidate) { return $null }
  $nodeExe = Join-Path $candidate 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) { return $null }
  if ((Get-NodeMajor $nodeExe) -lt $MinimumMajor) { return $null }
  return $candidate
}

function Invoke-Download([string]$Uri, [string]$OutFile) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Write-Step "Downloading $([IO.Path]::GetFileName($OutFile)) (attempt $attempt of 3)..."
      Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
      return
    } catch {
      $lastError = $_
      if ($attempt -lt 3) { Start-Sleep -Seconds (2 * $attempt) }
    }
  }
  throw $lastError
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null

$systemNode = Get-SystemNode
if ($systemNode) {
  Write-Step "Compatible Node.js already installed at $systemNode"
  Set-Content -LiteralPath $pathFile -Value $systemNode -Encoding ASCII
  exit 0
}

$cachedNode = Get-CachedNode
if ($cachedNode) {
  Write-Step "Using the private Node.js runtime at $cachedNode"
  exit 0
}

$architecture = switch ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  'X64' { 'x64' }
  'Arm64' { 'arm64' }
  'X86' { 'x86' }
  default { throw "Unsupported Windows architecture: $([Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
}

Write-Step 'Finding the current official Node.js LTS release...'
$releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
$fileToken = "win-$architecture-zip"
$release = $releases |
  Where-Object { $_.lts -and ([int]($_.version.TrimStart('v').Split('.')[0])) -ge $MinimumMajor -and $_.files -contains $fileToken } |
  Select-Object -First 1

if (-not $release) {
  throw "No compatible Node.js LTS Windows package was found for $architecture."
}

$version = [string]$release.version
$archiveName = "node-$version-win-$architecture.zip"
$archivePath = Join-Path $cacheRoot $archiveName
$checksumPath = Join-Path $cacheRoot 'SHASUMS256.txt'
$baseUri = "https://nodejs.org/dist/$version"

Invoke-Download "$baseUri/$archiveName" $archivePath
Invoke-Download "$baseUri/SHASUMS256.txt" $checksumPath

$checksumLine = Get-Content -LiteralPath $checksumPath |
  Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+$([regex]::Escape($archiveName))$" } |
  Select-Object -First 1

if (-not $checksumLine) {
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  throw "The official checksum list did not contain $archiveName."
}

$expectedHash = ([regex]::Match($checksumLine, '^([a-fA-F0-9]{64})')).Groups[1].Value.ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  throw 'Node.js download verification failed. The downloaded file was deleted.'
}

Write-Step "Verified official SHA-256 checksum for Node.js $version."
$extractRoot = Join-Path $runtimeRoot $version
if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force

$nodeDirectory = Get-ChildItem -LiteralPath $extractRoot -Directory |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $nodeDirectory) { throw 'Node.js extracted, but node.exe could not be located.' }
$installedMajor = Get-NodeMajor (Join-Path $nodeDirectory 'node.exe')
if ($installedMajor -lt $MinimumMajor) { throw "Downloaded Node.js did not meet the minimum version requirement ($MinimumMajor)." }

Set-Content -LiteralPath $pathFile -Value $nodeDirectory -Encoding ASCII
Write-Step "Private Node.js $version is ready. No administrator access or system-wide installation was required."
