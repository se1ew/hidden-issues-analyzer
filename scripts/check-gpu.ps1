param(
    [string]$ExpectedGpu = 'GTX 1080',
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\.cache\gpu-check.json'),
    [string]$RuntimePath
)

$ErrorActionPreference = 'Stop'
$report = [ordered]@{
    capturedAt = [DateTime]::UtcNow.ToString('o')
    expectedGpu = $ExpectedGpu
    os = $null
    systemRamMiB = $null
    gpus = @()
    expectedGpuFound = $false
    runtime = $null
    errors = @()
}

try {
    $osInfo = Get-CimInstance Win32_OperatingSystem
    $report.os = [ordered]@{ caption = $osInfo.Caption; version = $osInfo.Version; build = $osInfo.BuildNumber }
    $report.systemRamMiB = [Math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
    $smiCommand = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $smiCommand) { throw 'nvidia-smi.exe is not available; check the NVIDIA driver installation.' }
    $gpuRows = & $smiCommand.Source --query-gpu=index,name,driver_version,memory.total,memory.free --format=csv,noheader,nounits
    if ($LASTEXITCODE -ne 0) { throw 'nvidia-smi failed; no GPU compatibility claim can be made.' }
    foreach ($row in ($gpuRows | ConvertFrom-Csv -Header index,name,driver,total,free)) {
        $report.gpus += [ordered]@{
            index = [int]$row.index.Trim()
            name = $row.name.Trim()
            driverVersion = $row.driver.Trim()
            totalMiB = [int]$row.total.Trim()
            freeMiBAtCapture = [int]$row.free.Trim()
        }
    }
    $report.expectedGpuFound = @($report.gpus | Where-Object { $_.name -like "*$ExpectedGpu*" }).Count -gt 0
    if (-not $report.expectedGpuFound) { $report.errors += "Expected GPU '$ExpectedGpu' was not found." }
    if ($RuntimePath) {
        $resolvedRuntime = (Resolve-Path -LiteralPath $RuntimePath).Path
        $runtimeVersion = @(& $resolvedRuntime --version 2>&1 | ForEach-Object { $_.ToString() })
        if ($LASTEXITCODE -ne 0) { throw 'Runtime --version failed.' }
        $runtimeDevices = @(& $resolvedRuntime --list-devices 2>&1 | ForEach-Object { $_.ToString() })
        if ($LASTEXITCODE -ne 0) { throw 'Runtime --list-devices failed.' }
        $report.runtime = [ordered]@{ version = $runtimeVersion; devices = $runtimeDevices }
    }
} catch {
    $report.errors += $_.Exception.Message
}

$absoluteOutput = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path $absoluteOutput) -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $absoluteOutput -Encoding UTF8
Write-Output "Saved GPU report: $absoluteOutput"
foreach ($gpu in $report.gpus) {
    Write-Output "$($gpu.name): driver $($gpu.driverVersion), $($gpu.freeMiBAtCapture)/$($gpu.totalMiB) MiB free at capture"
}
if ($report.errors.Count -gt 0) {
    foreach ($errorMessage in $report.errors) { Write-Output $errorMessage }
    exit 1
}
Write-Output 'GPU is visible. Runtime device listing alone does not prove GPU inference or model quality.'
