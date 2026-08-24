param(
  [ValidateSet('validate', 'report')]
  [string]$Phase = 'validate',
  [ValidateSet('owner-test', 'stable')]
  [string]$Channel = 'owner-test',
  [string]$DistDir = 'dist'
)

$ErrorActionPreference = 'Stop'

function Has-Value {
  param([string]$Value)
  return -not [string]::IsNullOrWhiteSpace($Value)
}

$linkPresent = Has-Value $env:WIN_CSC_LINK
$passwordPresent = Has-Value $env:WIN_CSC_KEY_PASSWORD
if ($linkPresent -xor $passwordPresent) {
  throw 'Windows signing configuration is incomplete. WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD must either both be set or both be absent.'
}

$signingConfigured = $linkPresent -and $passwordPresent
if ($Channel -eq 'stable' -and -not $signingConfigured) {
  throw 'Stable Windows validation requires Authenticode signing credentials. Configure WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD as protected CI secrets.'
}

if ($Phase -eq 'validate') {
  if ($signingConfigured) { Write-Host "Windows signing enabled for $Channel validation." }
  else { Write-Host 'Windows signing is intentionally disabled for this owner-test validation.' }
  exit 0
}

$package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$version = [string]$package.version
$dist = [IO.Path]::GetFullPath($DistDir)
$installerPath = Join-Path $dist "Khaos-Nexus-$version-Setup.exe"
$appPath = Join-Path $dist 'win-unpacked\Khaos Nexus.exe'
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Signing report cannot find installer: $installerPath" }
if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw "Signing report cannot find packaged app: $appPath" }

$installerSignature = Get-AuthenticodeSignature -LiteralPath $installerPath
$appSignature = Get-AuthenticodeSignature -LiteralPath $appPath
$installerValid = [string]$installerSignature.Status -eq 'Valid'
$appValid = [string]$appSignature.Status -eq 'Valid'
$signed = $installerValid -and $appValid

if ($signingConfigured -and -not $signed) {
  throw "Signing credentials were provided but Authenticode verification failed. Installer=$($installerSignature.Status); App=$($appSignature.Status)."
}
if ($Channel -eq 'stable' -and -not $signed) {
  throw 'Stable Windows validation produced an unsigned or invalidly signed artifact.'
}

$signer = $installerSignature.SignerCertificate
$report = [ordered]@{
  schemaVersion = 1
  product = 'khaos-nexus'
  version = $version
  channel = $Channel
  signingConfigured = $signingConfigured
  mode = if ($signed) { 'signed' } else { 'unsigned-owner-test' }
  installer = [ordered]@{
    status = [string]$installerSignature.Status
    statusMessage = [string]$installerSignature.StatusMessage
  }
  application = [ordered]@{
    status = [string]$appSignature.Status
    statusMessage = [string]$appSignature.StatusMessage
  }
  signer = if ($signed -and $signer) {
    [ordered]@{
      subject = [string]$signer.Subject
      issuer = [string]$signer.Issuer
      thumbprint = [string]$signer.Thumbprint
      notBefore = $signer.NotBefore.ToUniversalTime().ToString('o')
      notAfter = $signer.NotAfter.ToUniversalTime().ToString('o')
    }
  } else { $null }
  generatedAt = [DateTime]::UtcNow.ToString('o')
}

$reportPath = Join-Path $dist 'nexus-windows-signing.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Windows signing report: $reportPath ($($report.mode))"
