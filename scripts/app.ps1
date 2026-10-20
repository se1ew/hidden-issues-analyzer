param(
    [ValidateSet('Init','Build','Start','Stop','Status','Logs','InstallAutostart','RemoveAutostart')]
    [string]$Action = 'Status',
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\deploy\.env'),
    [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,50}$')][string]$ProjectName = 'reviewlens',
    [ValidateRange(1024,65535)][int]$Port = 8080,
    [string]$HostAddress = 'localhost',
    [string]$RuntimeScript,
    [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = [IO.Path]::GetFullPath($EnvFile)
$composePath = Join-Path $root 'compose.production.yaml'
$taskName = "ReviewLens-$ProjectName"
function New-HexSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
function Invoke-Compose {
    param([string[]]$Command)
    $previousEnvFile = $env:APP_ENV_FILE
    try {
        $env:APP_ENV_FILE = $envPath
        & docker compose --env-file $envPath -f $composePath -p $ProjectName @Command
        if ($LASTEXITCODE -ne 0) { throw "Compose action failed: $($Command[0])" }
    } finally { $env:APP_ENV_FILE = $previousEnvFile }
}
if ($RuntimeScript) { $RuntimeScript = (Resolve-Path -LiteralPath $RuntimeScript).Path }
if ($WhatIf) {
    Write-Output "Action=$Action; project=$ProjectName; env=$envPath; task=$taskName"
    exit 0
}
if ($Action -eq 'Init') {
    if (Test-Path -LiteralPath $envPath) { throw 'Environment file already exists; it will not be overwritten.' }
    $origin = [Uri]"http://${HostAddress}:$Port"
    if ($origin.Host -ne $HostAddress -or $origin.UserInfo -or $origin.AbsolutePath -ne '/') { throw 'HostAddress must be a host name or IPv4 address.' }
    $bindAddress = '0.0.0.0'
    if ($HostAddress -in @('localhost','127.0.0.1')) { $bindAddress = '127.0.0.1' }
    $content = Get-Content -LiteralPath (Join-Path $root 'deploy\.env.example') -Raw
    $content = $content.Replace('change_me_database_password', (New-HexSecret)).Replace('change_me_access_secret_at_least_32_chars', (New-HexSecret)).Replace('change_me_refresh_secret_at_least_32_chars', (New-HexSecret))
    $content = $content.Replace('APP_BIND=127.0.0.1', "APP_BIND=$bindAddress").Replace('APP_PORT=8080', "APP_PORT=$Port").Replace('WEB_ORIGIN=http://localhost:8080', "WEB_ORIGIN=http://${HostAddress}:$Port")
    New-Item -ItemType Directory -Path (Split-Path $envPath) -Force | Out-Null
    # CreateNew prevents concurrent initialization from replacing existing secrets.
    $stream = [IO.File]::Open($envPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($content); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    Write-Output "Created $envPath. Set the verified runtime model ID before analysis."
    exit 0
}
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Run -Action Init first.' }
switch ($Action) {
    'Build' { Invoke-Compose -Command @('build','api') }
    'Start' {
        if ($RuntimeScript) { & $RuntimeScript }
        $ready = $false
        for ($attempt = 0; $attempt -lt 120; $attempt++) {
            & docker info --format '{{.ServerVersion}}' *> $null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            if ($attempt -eq 0) {
                $desktopPaths = @((Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'), (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'))
                foreach ($desktop in $desktopPaths) { if (Test-Path -LiteralPath $desktop) { Start-Process -FilePath $desktop -WindowStyle Hidden; break } }
            }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw 'Docker did not become ready within 120 seconds.' }
        Invoke-Compose -Command @('up','-d','--no-build','--wait','--wait-timeout','120')
    }
    'Stop' { Invoke-Compose -Command @('stop') }
    'Status' { Invoke-Compose -Command @('ps','-a') }
    'Logs' { Invoke-Compose -Command @('logs','--tail','100','api','worker') }
    'InstallAutostart' {
        $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Action Start -EnvFile `"$envPath`" -ProjectName `"$ProjectName`""
        if ($RuntimeScript) { $arguments += " -RuntimeScript `"$RuntimeScript`"" }
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($existing -and $existing.Actions.Arguments -notlike "*$PSCommandPath*") { throw 'A different task already uses this name.' }
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
        $trigger.Delay = 'PT30S'
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
        Write-Output "Installed $taskName for the current user. Reboot verification is required on the target PC."
    }
    'RemoveAutostart' {
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($existing) {
            if ($existing.Actions.Arguments -notlike "*$PSCommandPath*") { throw 'Refusing to remove an unrelated task.' }
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        }
    }
}
