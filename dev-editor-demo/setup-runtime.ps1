$ErrorActionPreference = 'Stop'
$runtimeManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
$runtimeDirectory = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
foreach ($runtimeEntry in $runtimeManifest.files.PSObject.Properties) {
    $runtimeTarget = Join-Path $runtimeDirectory $runtimeEntry.Name
    if (-not (Test-Path -LiteralPath $runtimeTarget)) {
        Invoke-WebRequest -Uri ($runtimeManifest.baseURL + $runtimeEntry.Name) -OutFile $runtimeTarget
    }
    if ((Get-FileHash -LiteralPath $runtimeTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeEntry.Value) {
        throw ('Runtime checksum mismatch: ' + $runtimeEntry.Name)
    }
}
Write-Host 'Pinned local Python runtime verified.'
