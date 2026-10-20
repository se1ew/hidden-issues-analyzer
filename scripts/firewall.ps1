[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [ValidateRange(1024,65535)][int]$Port = 8080,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
if ($Port -in @(4000,5432,6379,8081)) { throw 'Choose a dedicated application port, not a database, queue or model port.' }
$ruleName = "ReviewLens-App-$Port"
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing -and $existing.Group -ne 'ReviewLens') { throw 'An unrelated firewall rule already uses this name.' }
if ($Remove) {
    if ($existing -and $PSCmdlet.ShouldProcess($ruleName,'Remove ReviewLens application rule')) { Remove-NetFirewallRule -Name $ruleName }
} elseif ($PSCmdlet.ShouldProcess("TCP $Port on private local subnet",'Allow ReviewLens browser access')) {
    if ($existing) { Remove-NetFirewallRule -Name $ruleName }
    New-NetFirewallRule -Name $ruleName -DisplayName "ReviewLens application TCP $Port" -Group 'ReviewLens' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null
    Write-Output 'Only the application port is allowed on the private local subnet. Database, Redis and model ports were not opened.'
}
