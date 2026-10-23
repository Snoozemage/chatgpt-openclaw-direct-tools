$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = Join-Path $repoRoot 'src'

$files = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter '*.mjs')
if ($files.Count -eq 0) { throw "No .mjs source files found under $sourceRoot" }

foreach ($file in $files) {
    Write-Host ("Checking JavaScript syntax: " + $file.FullName)
    & node --check $file.FullName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$scriptFiles = @(
    Get-ChildItem -LiteralPath $repoRoot -File -Filter '*.ps1'
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tests') -Recurse -File -Filter '*.ps1'
)
foreach ($script in $scriptFiles) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) {
        $parseErrors | ForEach-Object {
            Write-Error ("PowerShell syntax error in " + $script.FullName + " at line " + $_.Extent.StartLineNumber + ": " + $_.Message)
        }
        exit 1
    }
    Write-Host ("Checking PowerShell syntax: " + $script.FullName)
}

$legacyPaths = @(
    (Join-Path $sourceRoot 'tools\catalog-tools.mjs'),
    (Join-Path $sourceRoot 'tools\computer-tools.mjs'),
    (Join-Path $sourceRoot 'tools\gateway-tools.mjs')
)
$legacyFiles = @($legacyPaths | Where-Object { Test-Path -LiteralPath $_ })
if ($legacyFiles.Count -gt 0) {
    throw ("Obsolete tool modules remain after the architecture cleanup: " + ($legacyFiles -join ', '))
}
$legacyOpenClawDir = Join-Path $sourceRoot 'openclaw'
if (Test-Path -LiteralPath $legacyOpenClawDir) {
    throw ("The obsolete src/openclaw directory should not exist: " + $legacyOpenClawDir)
}
Write-Host 'Checking source architecture: obsolete tool modules and src/openclaw directory are absent.'

$startScript = Get-Content -LiteralPath (Join-Path $repoRoot 'start.ps1') -Raw
$stopScript = Get-Content -LiteralPath (Join-Path $repoRoot 'stop.ps1') -Raw
$gatewayStartValid = $startScript.Contains('gateway run --port') -and $startScript.Contains('gateway.pid') -and $startScript.Contains('Wait-Port $gatewayPort 300')
$logonScript = Get-Content -LiteralPath (Join-Path $repoRoot 'start-on-logon.ps1') -Raw
$logonStartValid = $logonScript.Contains('autostart.log') -and $logonScript.Contains('param()') -and $logonScript.Contains('$maxAttempts = 2') -and $logonScript.Contains('Retrying in 20 seconds')
$gatewayStopValid = $stopScript.Contains('Stop-OwnedProcess -PidFile $GatewayPidFile') -and $stopScript.Contains('gateway run')
if (-not $gatewayStartValid) { throw 'Gateway startup contract failed: start.ps1 must launch Gateway, record its PID, and allow up to 300 seconds for the listener.' }
if (-not $logonStartValid) { throw 'Logon startup contract failed: start-on-logon.ps1 must log startup output and retry one failed attempt.' }
if (-not $gatewayStopValid) { throw 'Gateway shutdown contract failed: stop.ps1 must stop only the process recorded in gateway.pid after command identity validation.' }
Write-Host 'Checking lifecycle contract: Gateway start, diagnostic logon wrapper, and ownership-aware stop are present.'
Write-Host ("All checks passed: " + $files.Count + " JavaScript module(s), " + $scriptFiles.Count + " PowerShell script(s).")
