param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'))

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $resolvedOutput.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw 'Release output must be inside the project directory.'
}

$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$required = @(
    "VortexBrowser-Setup-$version.exe",
    "VortexBrowser-Setup-$version.exe.blockmap",
    "VortexBrowser-Portable-$version.exe",
    'latest.yml'
)
$missing = $required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $resolvedOutput $_)) }
if ($missing.Count) { throw "Missing release artifacts: $($missing -join ', ')" }

$unexpectedExecutables = Get-ChildItem -LiteralPath $resolvedOutput -File -Filter 'VortexBrowser-*.exe' |
    Where-Object { $_.Name -notin $required }
if ($unexpectedExecutables.Count) {
    throw "Unexpected release executables: $($unexpectedExecutables.Name -join ', ')"
}

$latest = Get-Content -LiteralPath (Join-Path $resolvedOutput 'latest.yml') -Raw
if ($latest -notmatch "(?m)^version:\s*$([regex]::Escape($version))\s*$") {
    throw "latest.yml does not declare version $version."
}

$artifacts = $required | ForEach-Object { Get-Item -LiteralPath (Join-Path $resolvedOutput $_) }
$hashes = $artifacts | Get-FileHash -Algorithm SHA256
$hashPath = Join-Path $resolvedOutput "SHA256SUMS-$version.txt"
$hashLines = $hashes | ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($_.Path))" }
[System.IO.File]::WriteAllLines($hashPath, $hashLines)

$signatures = $artifacts | Where-Object Extension -eq '.exe' | ForEach-Object {
    $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
    [pscustomobject]@{ File = $_.Name; Signature = $signature.Status }
}

Write-Output "Verified Vortex Browser $version release artifacts."
$artifacts | Select-Object Name, Length | Format-Table -AutoSize
$signatures | Format-Table -AutoSize
Write-Output "SHA-256 manifest: $hashPath"
