param(
  [string]$DistDir = 'dist',
  [ValidateSet('owner-test', 'stable')]
  [string]$Channel = 'owner-test'
)

$ErrorActionPreference = 'Stop'

$packageJson = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$source = Join-Path $DistDir 'win-unpacked'
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "Windows unpacked build not found at $source. Run electron-builder first."
}

$zipName = "Khaos-Nexus-$version-update.zip"
$zipPath = Join-Path $DistDir $zipName
$manifestPath = Join-Path $DistDir 'nexus-update-manifest.json'

Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $source '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $zipPath).Length

$manifest = [ordered]@{
  schemaVersion = 1
  product = 'khaos-nexus'
  version = $version
  channel = $Channel
  notes = "Khaos Nexus $version $Channel staged update."
  restartRequired = $true
  installerRequired = $false
  package = [ordered]@{
    name = $zipName
    sha256 = $hash
    size = $size
  }
  generatedAt = [DateTime]::UtcNow.ToString('o')
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "Created staged update bundle: $zipPath"
Write-Host "SHA-256: $hash"
Write-Host "Manifest: $manifestPath"
