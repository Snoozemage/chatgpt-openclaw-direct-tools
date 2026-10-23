[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$AppHome = Join-Path $env:LOCALAPPDATA 'OpenClawChatGPTBridge'
$ConfigFile = Join-Path $AppHome 'config.json'
$GatewayPidFile = Join-Path $AppHome 'gateway.pid'
$BridgePidFile = Join-Path $AppHome 'bridge.pid'
$TunnelPidFile = Join-Path $AppHome 'tunnel-client.pid'

function Read-LocalConfig {
    if (-not (Test-Path -LiteralPath $ConfigFile)) { throw 'Run setup.ps1 before start.ps1.' }
    $script:Cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
    foreach ($key in @('openclawConfigPath','openclawCliPath','nodePath','tunnelClientPath','tunnelProfilePath','apiKeyPath','bridgePort','gatewayPort','tunnelHealthPort')) {
        if ($null -eq $script:Cfg.$key -or [string]::IsNullOrWhiteSpace([string]$script:Cfg.$key)) { throw "Local config is missing '$key'. Re-run setup.ps1." }
    }
}
function Get-Json([string]$Url) { try { Invoke-RestMethod -Uri $Url -TimeoutSec 2 } catch { $null } }
function Test-Port([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $task = $client.ConnectAsync('127.0.0.1', $Port); return $task.Wait(500) -and $client.Connected }
    catch { return $false } finally { $client.Dispose() }
}
function Wait-Port([int]$Port, [int]$Seconds) {
    $until = (Get-Date).AddSeconds($Seconds)
    do { if (Test-Port $Port) { return $true }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $until)
    return $false
}
function Wait-Json([string]$Url, [int]$Seconds) {
    $until = (Get-Date).AddSeconds($Seconds)
    do { $v = Get-Json $Url; if ($null -ne $v) { return $v }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $until)
    return $null
}
function Start-LoggedProcess([string]$FilePath, [string]$Arguments, [string]$OutFile, [string]$ErrFile, [string]$WorkingDirectory) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    foreach ($logPath in @($OutFile, $ErrFile)) {
        if (Test-Path -LiteralPath $logPath) { Move-Item -LiteralPath $logPath -Destination ($logPath + '.' + $stamp + '.previous') -Force }
    }
    if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) { $WorkingDirectory = $RepoRoot }
    Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile -PassThru
}

Read-LocalConfig
$Cfg = $script:Cfg
$LogDir = [string]$Cfg.logDir
if (-not $LogDir) { $LogDir = Join-Path $AppHome 'logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$env:OPENCLAW_HOME = [string]$Cfg.openclawHome
$env:OPENCLAW_STATE_DIR = [string]$Cfg.openclawStateDir
$env:OPENCLAW_CONFIG_PATH = [string]$Cfg.openclawConfigPath
$env:OPENCLAW_WORKSPACE_DIR = Join-Path ([string]$Cfg.openclawStateDir) 'workspace'
$env:OPENCLAW_CLI_PATH = [string]$Cfg.openclawCliPath
$env:OPENCLAW_NODE_PATH = [string]$Cfg.nodePath
$env:OPENCLAW_BRIDGE_HOST = '127.0.0.1'
$env:OPENCLAW_BRIDGE_PORT = [string]$Cfg.bridgePort
$env:OPENCLAW_BRIDGE_AGENT = if ($Cfg.agentId) { [string]$Cfg.agentId } else { 'main' }
$env:OPENCLAW_GATEWAY_PORT = [string]$Cfg.gatewayPort
$env:OPENCLAW_BRIDGE_INVOKE_TIMEOUT_MS = '120000'

# Start Gateway directly when nothing is listening; do not take over an existing service/process.
$gatewayPort = [int]$Cfg.gatewayPort
if (Test-Port $gatewayPort) {
    Write-Host "OpenClaw Gateway already listening on 127.0.0.1:$gatewayPort; leaving that process untouched." -ForegroundColor Green
} else {
    Write-Host "Starting OpenClaw Gateway on 127.0.0.1:$gatewayPort ..."
    $gatewayOut = Join-Path $LogDir 'gateway.stdout.log'
    $gatewayErr = Join-Path $LogDir 'gateway.stderr.log'
    $gatewayArgs = '"' + [string]$Cfg.openclawCliPath + '" gateway run --port ' + $gatewayPort
    $gatewayProcess = Start-LoggedProcess -FilePath ([string]$Cfg.nodePath) -Arguments $gatewayArgs -OutFile $gatewayOut -ErrFile $gatewayErr -WorkingDirectory ([string]$Cfg.openclawHome)
    Set-Content -LiteralPath $GatewayPidFile -Value $gatewayProcess.Id -Encoding ASCII
    if (-not (Wait-Port $gatewayPort 300)) {
        $gatewayDetails = @()
        if (Test-Path -LiteralPath $gatewayErr) { $gatewayDetails += (Get-Content -LiteralPath $gatewayErr -Tail 30) }
        if (Test-Path -LiteralPath $gatewayOut) { $gatewayDetails += (Get-Content -LiteralPath $gatewayOut -Tail 20) }
        $gatewayDetailsText = $gatewayDetails -join [Environment]::NewLine
        $stillRunning = Get-Process -Id $gatewayProcess.Id -ErrorAction SilentlyContinue
        if ($stillRunning) { Stop-Process -Id $gatewayProcess.Id -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $GatewayPidFile -Force -ErrorAction SilentlyContinue
        throw "OpenClaw Gateway failed to listen on port $gatewayPort within 120 seconds. See $gatewayOut and $gatewayErr. $gatewayDetailsText"
    }
    Write-Host "OpenClaw Gateway started (PID $($gatewayProcess.Id))." -ForegroundColor Green
}

$base = 'http://127.0.0.1:' + $Cfg.bridgePort
$health = Get-Json ($base + '/healthz')
if ($health -and $health.server -eq 'openclaw-chatgpt-bridge') {
    Write-Host "MCP bridge already running at $base" -ForegroundColor Green
} else {
    if (Test-Port ([int]$Cfg.bridgePort)) { throw "Bridge port $($Cfg.bridgePort) is occupied by a different process. Change it in local config/setup.ps1." }
    Write-Host "Starting MCP bridge at $base ..."
    $out = Join-Path $LogDir 'bridge.stdout.log'
    $err = Join-Path $LogDir 'bridge.stderr.log'
    $scriptPath = Join-Path $RepoRoot 'src\server.mjs'
    $proc = Start-LoggedProcess -FilePath ([string]$Cfg.nodePath) -Arguments ('"' + $scriptPath + '"') -OutFile $out -ErrFile $err -WorkingDirectory $RepoRoot
    Set-Content -LiteralPath $BridgePidFile -Value $proc.Id -Encoding ASCII
    $health = Wait-Json ($base + '/healthz') 45
    if (-not $health -or -not $health.ok) {
        $details = if (Test-Path $err) { (Get-Content $err -Tail 30) -join [Environment]::NewLine } else { 'No stderr log available.' }
        throw "Bridge failed to start. See $err. $details"
    }
    Write-Host "MCP bridge started (PID $($proc.Id))." -ForegroundColor Green
}

$tunnelHealth = 'http://127.0.0.1:' + $Cfg.tunnelHealthPort
$ready = Get-Json ($tunnelHealth + '/readyz')
if ($ready -and (($ready -is [string] -and $ready.Trim() -eq 'ready') -or $ready.status -eq 'ready')) {
    Write-Host 'Tunnel client is already ready.' -ForegroundColor Green
} else {
    if (Test-Port ([int]$Cfg.tunnelHealthPort)) { throw "Tunnel health port $($Cfg.tunnelHealthPort) is occupied but is not reporting ready. Resolve the conflict or update setup." }
    Write-Host 'Starting Secure MCP Tunnel client ...'
    $out = Join-Path $LogDir 'tunnel-client.stdout.log'
    $err = Join-Path $LogDir 'tunnel-client.stderr.log'
    $profileArg = '"' + [string]$Cfg.tunnelProfilePath + '"'
    $keyArg = '"file:' + [string]$Cfg.apiKeyPath + '"'
    $tunnelArgs = 'run --config ' + $profileArg + ' --control-plane.api-key ' + $keyArg
    $proc = Start-LoggedProcess -FilePath ([string]$Cfg.tunnelClientPath) -Arguments $tunnelArgs -OutFile $out -ErrFile $err -WorkingDirectory $RepoRoot
    Set-Content -LiteralPath $TunnelPidFile -Value $proc.Id -Encoding ASCII
    $ready = Wait-Json ($tunnelHealth + '/readyz') 45
    if (-not $ready -or -not (($ready -is [string] -and $ready.Trim() -eq 'ready') -or $ready.status -eq 'ready')) {
        $details = if (Test-Path $err) { (Get-Content $err -Tail 40) -join [Environment]::NewLine } else { 'No stderr log available.' }
        throw "Tunnel client did not become ready. See $err. $details"
    }
    Write-Host "Tunnel client started (PID $($proc.Id))." -ForegroundColor Green
}

Write-Host ''
Write-Host 'OpenClaw × ChatGPT is ready.' -ForegroundColor Green
Write-Host ('Overview: ' + $base + '/monitor')
Write-Host ('Health:   ' + $base + '/healthz')
Write-Host ('Logs:     ' + $LogDir)
if (-not $NoBrowser) { Start-Process ($base + '/monitor') }
