param([string]$Directory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$bundleRoot = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$manifest = Get-Content -LiteralPath (Join-Path $bundleRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne 1) { throw 'Unsupported bundle manifest.' }
foreach ($entry in $manifest.files) {
    $file = [IO.Path]::GetFullPath((Join-Path $bundleRoot $entry.path))
    if (-not $file.StartsWith($bundleRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes the bundle.' }
    $item = Get-Item -LiteralPath $file
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected a regular bundle file.' }
    if ($item.Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Bundle checksum failed: $($entry.path)" }
}
Write-Output "Verified $($manifest.files.Count) files; source commit $($manifest.sourceCommit). GPU runtime and instruct model are prepared separately."
