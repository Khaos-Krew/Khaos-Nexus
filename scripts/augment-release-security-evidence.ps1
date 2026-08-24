param(
  [ValidateSet('owner-test', 'stable')]
  [string]$Channel,
  [string]$DistDir = 'dist'
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

$dist = [IO.Path]::GetFullPath($DistDir)
$manifestPath = Join-Path $dist 'nexus-update-manifest.json'
$signingPath = Join-Path $dist 'nexus-windows-signing.json'
$packageAuditPath = Join-Path $dist 'nexus-package-audit.json'
$provenancePath = Join-Path $dist 'nexus-release-provenance.json'

foreach ($path in @($manifestPath, $signingPath, $packageAuditPath, $provenancePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Validated release artifact is missing required security evidence: $path"
  }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$signing = Get-Content -LiteralPath $signingPath -Raw | ConvertFrom-Json
$packageAudit = Get-Content -LiteralPath $packageAuditPath -Raw | ConvertFrom-Json
$provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ([string]$manifest.product -ne 'khaos-nexus' -or [string]$manifest.channel -ne $Channel) {
  throw 'Release manifest identity/channel does not match requested security validation.'
}
if ([string]$signing.product -ne 'khaos-nexus' -or [string]$signing.version -ne $version -or [string]$signing.channel -ne $Channel) {
  throw 'Windows signing report identity does not match the validated release artifact.'
}
if ([string]$packageAudit.product -ne 'khaos-nexus' -or [string]$packageAudit.version -ne $version) {
  throw 'Windows package-audit report identity does not match the validated release artifact.'
}
if ($packageAudit.ok -ne $true) { throw 'Windows package audit did not pass.' }
if (@($packageAudit.asar.missingRequired).Count -ne 0 -or @($packageAudit.asar.forbidden).Count -ne 0 -or @($packageAudit.asar.secretBearing).Count -ne 0) {
  throw 'Windows package audit contains unresolved findings.'
}

if ($Channel -eq 'stable' -and [string]$signing.mode -ne 'signed') {
  throw 'Stable release requires a signed validated Windows artifact.'
}
if ([string]$signing.mode -eq 'signed') {
  if ([string]$signing.installer.status -ne 'Valid' -or [string]$signing.application.status -ne 'Valid') {
    throw 'Signing report claims signed mode but Authenticode validation is not valid for both installer and application.'
  }
} elseif ($Channel -ne 'owner-test' -or [string]$signing.mode -ne 'unsigned-owner-test') {
  throw "Unexpected Windows signing mode '$($signing.mode)' for channel '$Channel'."
}

$signingHash = Get-Sha256Hex -Path $signingPath
$packageAuditHash = Get-Sha256Hex -Path $packageAuditPath

$validation = [ordered]@{}
foreach ($property in $provenance.validation.PSObject.Properties) { $validation[$property.Name] = $property.Value }
$validation['packageAudit'] = 'passed'
$validation['authenticode'] = if ([string]$signing.mode -eq 'signed') { 'passed' } else { 'unsigned-owner-test' }
$provenance.validation = [pscustomobject]$validation

$provenance | Add-Member -NotePropertyName security -NotePropertyValue ([pscustomobject][ordered]@{
  signingMode = [string]$signing.mode
  signingHash = $signingHash
  packageAuditHash = $packageAuditHash
}) -Force

$files = @($provenance.files)
$files += [pscustomobject][ordered]@{
  name = [IO.Path]::GetFileName($signingPath)
  sha256 = $signingHash
  size = (Get-Item -LiteralPath $signingPath).Length
}
$files += [pscustomobject][ordered]@{
  name = [IO.Path]::GetFileName($packageAuditPath)
  sha256 = $packageAuditHash
  size = (Get-Item -LiteralPath $packageAuditPath).Length
}
$provenance.files = $files
$provenance | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $provenancePath -Encoding UTF8

Write-Host "Validated signing evidence SHA-256: $signingHash"
Write-Host "Validated package-audit evidence SHA-256: $packageAuditHash"
Write-Host "Release security evidence accepted for $Channel."
