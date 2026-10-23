[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$AppHome = Join-Path $env:LOCALAPPDATA 'OpenClawDirectCDPBridge'
$LogDir = Join-Path $AppHome 'logs'
$LogFile = Join-Path $LogDir 'autostart.log'
$StartScript = Join-Path $PSScriptRoot 'start.ps1'
$LogEncoding = [Text.UTF8Encoding]::new($false)

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 2MB) {
    Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.previous') -Force
}

function Write-StartupLog([string]$Message) {
    $lines = ($Message -split '\r?\n')
    foreach ($line in $lines) {
        $entry = '[' + (Get-Date).ToString('o') + '] ' + $line + [Environment]::NewLine
        [IO.File]::AppendAllText($LogFile, $entry, $LogEncoding)
    }
}

Write-StartupLog ('Windows logon startup entered. User=' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
if (-not (Test-Path -LiteralPath $StartScript -PathType Leaf)) {
    Write-StartupLog ('FATAL: start script not found: ' + $StartScript)
    exit 1
}

$maxAttempts = 2
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
        Write-StartupLog ('Starting stack, attempt ' + $attempt + ' of ' + $maxAttempts + '.')
        & $StartScript -NoBrowser *>&1 | ForEach-Object {
            $message = ($_ | Out-String -Width 240).TrimEnd()
            if ($message) { Write-StartupLog $message }
        }
        Write-StartupLog ('Startup succeeded on attempt ' + $attempt + '.')
        exit 0
    }
    catch {
        Write-StartupLog ('Startup attempt ' + $attempt + ' failed: ' + $_.Exception.Message)
        Write-StartupLog (($_ | Format-List * -Force | Out-String -Width 240).TrimEnd())
        if ($attempt -lt $maxAttempts) {
            Write-StartupLog 'Retrying in 20 seconds.'
            Start-Sleep -Seconds 20
        }
    }
}

Write-StartupLog 'FATAL: stack startup failed after all attempts.'
exit 1
