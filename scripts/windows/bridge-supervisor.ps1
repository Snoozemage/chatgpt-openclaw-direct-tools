[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$AppHome = Join-Path $env:LOCALAPPDATA 'OpenClawChatGPTBridge'
$ConfigFile = Join-Path $AppHome 'config.json'
$LogDir = Join-Path $AppHome 'logs'
$RestartLog = Join-Path $LogDir 'bridge.restart.log'
$SupervisorPidFile = Join-Path $AppHome 'bridge-supervisor.pid'
$BridgePidFile = Join-Path $AppHome 'bridge.pid'
$StopRequestFile = Join-Path $AppHome 'bridge-supervisor.stop'
$BridgeScript = Join-Path $RepoRoot 'src\server.mjs'
$Mutex = $null
$OwnsMutex = $false
$BridgeProcess = $null
$ExitCode = 0

function Write-RestartLog([string]$Message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    Add-Content -LiteralPath $RestartLog -Value "[$stamp] $Message" -Encoding UTF8
}

function Get-Health {
    try {
        Invoke-RestMethod -Uri ("http://127.0.0.1:" + $script:BridgePort + '/healthz') -TimeoutSec 2
    } catch {
        $null
    }
}

function Remove-PidFile([string]$Path, [int]$ExpectedPid) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $current = 0
    $raw = (Get-Content -LiteralPath $Path -Raw).Trim()
    if ([int]::TryParse($raw, [ref]$current) -and $current -eq $ExpectedPid) {
        Remove-Item -LiteralPath $Path -Force
    }
}

function Stop-BridgeProcess([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            $deadline = (Get-Date).AddSeconds(10)
            do {
                Start-Sleep -Milliseconds 100
                $Process.Refresh()
            } while (-not $Process.HasExited -and (Get-Date) -lt $deadline)
        }
    } catch {}
}

function Rotate-Log([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    Move-Item -LiteralPath $Path -Destination ($Path + '.' + $stamp + '.previous') -Force
}

try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    if ((Test-Path -LiteralPath $RestartLog) -and (Get-Item -LiteralPath $RestartLog).Length -gt 2MB) {
        Rotate-Log $RestartLog
    }

    $Mutex = [System.Threading.Mutex]::new($false, 'Local\OpenClawChatGPTBridgeSupervisor')
    try {
        $OwnsMutex = $Mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $OwnsMutex = $true
    }

    if (-not $OwnsMutex) {
        Write-RestartLog 'Another bridge supervisor already owns the runtime; this instance is exiting.'
    } else {
        if (-not (Test-Path -LiteralPath $ConfigFile)) {
            throw "Local configuration not found: $ConfigFile"
        }

        $cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
        $nodePath = [string]$cfg.nodePath
        $script:BridgePort = [int]$cfg.bridgePort
        $LogDir = [string]$cfg.logDir
        if ([string]::IsNullOrWhiteSpace($LogDir)) {
            $LogDir = Join-Path $AppHome 'logs'
        }
        New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
        $RestartLog = Join-Path $LogDir 'bridge.restart.log'
        if ([string]::IsNullOrWhiteSpace($nodePath) -or -not (Test-Path -LiteralPath $nodePath)) {
            throw "Configured Node executable is missing: $nodePath"
        }
        if (-not (Test-Path -LiteralPath $BridgeScript)) {
            throw "Bridge entry point not found: $BridgeScript"
        }
        if (-not $cfg.openclawHome -or -not $cfg.openclawStateDir -or -not $cfg.openclawConfigPath -or -not $cfg.openclawCliPath) {
            throw 'Local config is missing required OpenClaw runtime paths.'
        }

        $env:OPENCLAW_HOME = [string]$cfg.openclawHome
        $env:OPENCLAW_STATE_DIR = [string]$cfg.openclawStateDir
        $env:OPENCLAW_CONFIG_PATH = [string]$cfg.openclawConfigPath
        $env:OPENCLAW_WORKSPACE_DIR = Join-Path ([string]$cfg.openclawStateDir) 'workspace'
        $env:OPENCLAW_CLI_PATH = [string]$cfg.openclawCliPath
        $env:OPENCLAW_NODE_PATH = $nodePath
        $env:OPENCLAW_BRIDGE_HOST = '127.0.0.1'
        $env:OPENCLAW_BRIDGE_PORT = [string]$script:BridgePort
        $env:OPENCLAW_BRIDGE_AGENT = if ($cfg.agentId) { [string]$cfg.agentId } else { 'main' }
        $env:OPENCLAW_GATEWAY_PORT = [string]$cfg.gatewayPort
        $env:OPENCLAW_BRIDGE_INVOKE_TIMEOUT_MS = '120000'
        $env:OPENCLAW_BRIDGE_SUPERVISED = '1'

        Set-Content -LiteralPath $SupervisorPidFile -Value $PID -Encoding ASCII
        Write-RestartLog "Bridge supervisor started (PID $PID). Gateway and Tunnel are outside its ownership."

        while (-not (Test-Path -LiteralPath $StopRequestFile)) {
            $listener = [Net.Sockets.TcpClient]::new()
            try {
                $connectTask = $listener.ConnectAsync('127.0.0.1', $script:BridgePort)
                if ($connectTask.Wait(500) -and $listener.Connected) {
                    throw "Bridge port $script:BridgePort is occupied before the supervisor starts a child. Refusing to manage an unknown process."
                }
            } finally {
                $listener.Dispose()
            }

            $out = Join-Path $LogDir 'bridge.stdout.log'
            $err = Join-Path $LogDir 'bridge.stderr.log'
            Rotate-Log $out
            Rotate-Log $err

            $BridgeProcess = Start-Process -FilePath $nodePath -ArgumentList @('"' + $BridgeScript + '"') -WorkingDirectory $RepoRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
            Set-Content -LiteralPath $BridgePidFile -Value $BridgeProcess.Id -Encoding ASCII
            $healthDeadline = (Get-Date).AddSeconds(45)
            $healthy = $false

            while ((Get-Date) -lt $healthDeadline) {
                if (Test-Path -LiteralPath $StopRequestFile) { break }
                $BridgeProcess.Refresh()
                if ($BridgeProcess.HasExited) { break }
                $health = Get-Health
                if ($health -and $health.ok -and $health.server -eq 'openclaw-chatgpt-bridge' -and [int]$health.pid -eq $BridgeProcess.Id) {
                    $healthy = $true
                    break
                }
                Start-Sleep -Milliseconds 250
            }

            if (Test-Path -LiteralPath $StopRequestFile) {
                Stop-BridgeProcess $BridgeProcess
                Remove-PidFile $BridgePidFile $BridgeProcess.Id
                break
            }

            if (-not $healthy) {
                $BridgeProcess.Refresh()
                $detail = if (Test-Path -LiteralPath $err) { (Get-Content -LiteralPath $err -Tail 25) -join [Environment]::NewLine } else { 'No stderr log available.' }
                Write-RestartLog "Bridge PID $($BridgeProcess.Id) did not become healthy. $detail"
                Stop-BridgeProcess $BridgeProcess
                Remove-PidFile $BridgePidFile $BridgeProcess.Id
                $BridgeProcess.Dispose()
                $BridgeProcess = $null
                Start-Sleep -Seconds 1
                continue
            }

            Write-RestartLog "Bridge started successfully (PID $($BridgeProcess.Id))."
            while ($true) {
                if (Test-Path -LiteralPath $StopRequestFile) {
                    Stop-BridgeProcess $BridgeProcess
                    break
                }
                $BridgeProcess.Refresh()
                if ($BridgeProcess.HasExited) { break }
                Start-Sleep -Milliseconds 250
            }

            $BridgeProcess.Refresh()
            $childPid = $BridgeProcess.Id
            $exitStatus = try { [string]$BridgeProcess.ExitCode } catch { 'unknown' }
            Remove-PidFile $BridgePidFile $childPid
            $BridgeProcess.Dispose()
            $BridgeProcess = $null

            if (Test-Path -LiteralPath $StopRequestFile) { break }
            Write-RestartLog "Bridge process $childPid exited with code $exitStatus; restarting the bridge only."
            Start-Sleep -Milliseconds 500
        }
    }
} catch {
    $ExitCode = 1
    try { Write-RestartLog ("Supervisor failed: " + $_.Exception.Message) } catch {}
} finally {
    if ($null -ne $BridgeProcess) {
        Stop-BridgeProcess $BridgeProcess
        Remove-PidFile $BridgePidFile $BridgeProcess.Id
        try { $BridgeProcess.Dispose() } catch {}
    }
    if ($OwnsMutex -and (Test-Path -LiteralPath $StopRequestFile)) {
        Remove-Item -LiteralPath $StopRequestFile -Force -ErrorAction SilentlyContinue
    }
    Remove-PidFile $SupervisorPidFile $PID
    if ($OwnsMutex -and $null -ne $Mutex) {
        try { $Mutex.ReleaseMutex() } catch {}
    }
    if ($null -ne $Mutex) { $Mutex.Dispose() }
    if ($OwnsMutex) {
        try { Write-RestartLog "Bridge supervisor stopped (exit code $ExitCode)." } catch {}
    }
}

exit $ExitCode
