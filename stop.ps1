[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$AppHome = Join-Path $env:LOCALAPPDATA 'OpenClawChatGPTBridge'
$ConfigFile = Join-Path $AppHome 'config.json'
if (-not (Test-Path -LiteralPath $ConfigFile)) { Write-Host 'No local configuration is installed.'; exit 0 }
$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$GatewayPidFile = Join-Path $AppHome 'gateway.pid'
$BridgePidFile = Join-Path $AppHome 'bridge.pid'
$TunnelPidFile = Join-Path $AppHome 'tunnel-client.pid'

function Stop-OwnedProcess([string]$PidFile, [string]$ExpectedExecutable, [string]$ExpectedArgument) {
    if (-not (Test-Path -LiteralPath $PidFile)) { return }
    $raw = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $id = 0
    if (-not [int]::TryParse($raw, [ref]$id) -or $id -le 0) { Remove-Item -LiteralPath $PidFile -Force; return }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { Remove-Item -LiteralPath $PidFile -Force; return }
    $exeMatches = $ExpectedExecutable -and $proc.ExecutablePath -and ($proc.ExecutablePath -ieq $ExpectedExecutable)
    $argMatches = $ExpectedArgument -and $proc.CommandLine -and ($proc.CommandLine -like ('*' + $ExpectedArgument + '*'))
    $owned = [bool]($exeMatches -and $argMatches)
    if (-not $owned) {
        Write-Warning "PID $id no longer matches the expected application; leaving it untouched."
        Remove-Item -LiteralPath $PidFile -Force
        return
    }
    Stop-Process -Id $id -Force -ErrorAction Stop
    Remove-Item -LiteralPath $PidFile -Force
    Write-Host "Stopped $($proc.Name) (PID $id)." -ForegroundColor Green
}

$bridgePath = Join-Path ([string]$cfg.repoPath) 'src\server.mjs'
Stop-OwnedProcess -PidFile $TunnelPidFile -ExpectedExecutable ([string]$cfg.tunnelClientPath) -ExpectedArgument 'tunnel-client'
Stop-OwnedProcess -PidFile $BridgePidFile -ExpectedExecutable ([string]$cfg.nodePath) -ExpectedArgument $bridgePath
$gatewayArgs = '"' + [string]$cfg.openclawCliPath + '" gateway run'
Stop-OwnedProcess -PidFile $GatewayPidFile -ExpectedExecutable ([string]$cfg.nodePath) -ExpectedArgument $gatewayArgs
Write-Host 'Stop complete. The Gateway is stopped only if start.ps1 launched it; pre-existing Gateway processes are left untouched.' -ForegroundColor Cyan
