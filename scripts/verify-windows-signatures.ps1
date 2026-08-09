param(
  [string]$Dist = "dist",
  [switch]$RequireSigned
)

$ErrorActionPreference = 'Stop'
if ($env:KHAOS_REQUIRE_SIGNING -eq '1') { $RequireSigned = $true }

$files = @(Get-ChildItem -LiteralPath $Dist -Filter 'Khaos-Nexus-*.exe' -File -ErrorAction SilentlyContinue)
if ($files.Count -eq 0) { throw "No Khaos Nexus Windows executables found under $Dist." }

$results = @()
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  $valid = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
  $results += [pscustomobject]@{
    name = $file.Name
    status = [string]$signature.Status
    signer = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }
    thumbprint = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null }
    valid = $valid
  }
  Write-Host "$($file.Name) | Authenticode=$($signature.Status) | Signer=$($results[-1].signer)"
  if ($RequireSigned -and -not $valid) { throw "Required Authenticode signature is not valid: $($file.Name) ($($signature.Status))." }
}

$report = [pscustomobject]@{
  schemaVersion = 1
  signingRequired = [bool]$RequireSigned
  files = $results
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Dist 'signing-audit.json') -Encoding utf8

if (-not $RequireSigned) {
  Write-Host 'Signing is currently advisory. Set repository/environment variable KHAOS_REQUIRE_SIGNING=1 after signing credentials are configured to make this gate mandatory.'
}
