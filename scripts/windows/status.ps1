[CmdletBinding()]
param(
    # Use -NoPause to disable the Explorer-launched prompt explicitly.
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$AppHome = Join-Path $env:LOCALAPPDATA 'OpenClawChatGPTBridge'
$ConfigFile = Join-Path $AppHome 'config.json'
$exitCode = 0

# When launched with "Run with PowerShell" from File Explorer, keep the
# console open so results and errors remain visible. Terminal runs stay non-blocking.
$pauseOnExit = $false
if (-not $NoPause) {
    try {
        $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop
        if ($currentProcess.ParentProcessId) {
            $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($currentProcess.ParentProcessId)" -ErrorAction Stop
            $pauseOnExit = $parentProcess.Name -ieq 'explorer.exe'
        }
    } catch {
        # If process ancestry cannot be determined, prefer normal non-interactive behavior.
        $pauseOnExit = $false
    }
}

function Get-Health([string]$Url) {
    try { Invoke-RestMethod -Uri $Url -TimeoutSec 3 } catch { $null }
}

try {
    if (-not (Test-Path -LiteralPath $ConfigFile)) {
        throw "Configuration not found: $ConfigFile. Run setup.ps1 first."
    }

    $cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
    foreach ($key in @('bridgePort', 'gatewayPort', 'tunnelHealthPort')) {
        if ($null -eq $cfg.$key -or [string]::IsNullOrWhiteSpace([string]$cfg.$key)) {
            throw "Local config is missing '$key'. Re-run setup.ps1."
        }
    }

    $bridgeUrl = 'http://127.0.0.1:' + $cfg.bridgePort
    $tunnelUrl = 'http://127.0.0.1:' + $cfg.tunnelHealthPort
    $bridge = Get-Health ($bridgeUrl + '/healthz')
    $events = Get-Health ($bridgeUrl + '/api/events')
    $tunnel = Get-Health ($tunnelUrl + '/readyz')

    $gatewayOk = $false
    $tcp = $null
    try {
        $tcp = [Net.Sockets.TcpClient]::new()
        $task = $tcp.ConnectAsync('127.0.0.1', [int]$cfg.gatewayPort)
        $gatewayOk = $task.Wait(1000) -and $tcp.Connected
    } catch {
        $gatewayOk = $false
    } finally {
        if ($null -ne $tcp) { $tcp.Dispose() }
    }

    $tunnelIsReady = $tunnel -and (($tunnel -is [string] -and $tunnel.Trim() -eq 'ready') -or $tunnel.status -eq 'ready')

    Write-Host ''
    Write-Host 'OpenClaw Direct Tools for ChatGPT - Status' -ForegroundColor Cyan
    [pscustomobject]@{Component='OpenClaw Gateway';Status=$(if ($gatewayOk) {'reachable'} else {'offline'});Endpoint=('127.0.0.1:' + $cfg.gatewayPort)} | Format-Table -AutoSize
    [pscustomobject]@{Component='MCP bridge';Status=$(if ($bridge -and $bridge.ok) {'running'} else {'offline'});Endpoint=$bridgeUrl} | Format-Table -AutoSize
    [pscustomobject]@{Component='Overview dashboard';Status=$(if ($bridge -and $bridge.ok) {'available'} else {'offline'});Endpoint=($bridgeUrl + '/monitor')} | Format-Table -AutoSize
    [pscustomobject]@{Component='Secure MCP Tunnel';Status=$(if ($tunnelIsReady) {'ready'} else {'not ready'});Endpoint=($tunnelUrl + '/readyz')} | Format-Table -AutoSize

    if ($events -and $events.events) {
        Write-Host ('Tracked events in memory: ' + $events.events.Count)
    }
    Write-Host ('Local config: ' + $ConfigFile)
    if ($cfg.logDir) { Write-Host ('Logs:         ' + $cfg.logDir) }

    if (-not $gatewayOk -or -not ($bridge -and $bridge.ok) -or -not $tunnelIsReady) {
        $exitCode = 1
        Write-Host ''
        Write-Host 'One or more components are offline or not ready. Review the logs and README troubleshooting section.' -ForegroundColor Yellow
    } else {
        Write-Host ''
        Write-Host 'All checked components are reachable.' -ForegroundColor Green
    }
}
catch {
    $exitCode = 1
    Write-Host ''
    Write-Host 'Status check failed:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
    if ($pauseOnExit) {
        Write-Host ''
        Write-Host 'Press Enter to close this window...' -ForegroundColor DarkGray
        [void](Read-Host)
    }
}

exit $exitCode
