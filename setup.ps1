[CmdletBinding()]
param(
    [string]$OpenClawConfigPath,
    [string]$OpenClawCliPath,
    [string]$NodePath,
    [string]$TunnelId,
    [int]$BridgePort = 19002,
    [int]$GatewayPort,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$AppHome = Join-Path $env:LOCALAPPDATA 'OpenClawChatGPTBridge'
$ConfigFile = Join-Path $AppHome 'config.json'
$SecretDir = Join-Path $AppHome 'secrets'
$SecretFile = Join-Path $SecretDir 'control-plane-api-key.txt'
$ProfileDir = Join-Path $AppHome 'tunnel-profiles'
$ProfileName = 'openclaw-chatgpt-bridge'
$ProfileFile = Join-Path $ProfileDir ($ProfileName + '.yaml')
$LogDir = Join-Path $AppHome 'logs'
$TunnelHealthPort = 8081

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Read-Default([string]$Prompt, [string]$Default) {
    if ([string]::IsNullOrWhiteSpace($Default)) { return (Read-Host $Prompt).Trim() }
    $answer = (Read-Host "$Prompt [$Default]").Trim()
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer
}
function Find-FirstFile([string[]]$Candidates) {
    foreach ($candidate in $Candidates) { if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return (Resolve-Path -LiteralPath $candidate).Path } }
    return $null
}
function Set-CurrentUserOnlyAcl([string]$Path, [bool]$IsDirectory = $false) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($IsDirectory) {
        & icacls.exe $Path /inheritance:r /grant:r "${identity}:(OI)(CI)F" /Q | Out-Null
    } else {
        & icacls.exe $Path /inheritance:r /grant:r "${identity}:F" /Q | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not set private file permissions on $Path (icacls exit $LASTEXITCODE)." }
}
function Save-ApiKey {
    Write-Host 'Paste the OpenAI runtime API key when prompted. Input is hidden and the key will not be printed.' -ForegroundColor Yellow
    $secure = Read-Host 'Runtime API key' -AsSecureString
    if ($secure.Length -lt 20) { throw 'The API key looks too short. No key was saved.' }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
        if ($plain.Length -lt 20 -or $plain -match '\s') { throw 'The API key appears invalid; no key was saved.' }
        [IO.File]::WriteAllText($SecretFile, $plain, [Text.UTF8Encoding]::new($false))
    }
    finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        $plain = $null
    }
    Set-CurrentUserOnlyAcl -Path $SecretFile
    Write-Host "Runtime key saved to a user-restricted file: $SecretFile" -ForegroundColor Green
}
function Get-OpenAiTunnelClient([string]$ExistingPath) {
    if ($ExistingPath -and (Test-Path -LiteralPath $ExistingPath -PathType Leaf)) { return (Resolve-Path -LiteralPath $ExistingPath).Path }
    $localCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\OpenChatX\runtime\bin\tunnel-client.exe'),
        (Join-Path $AppHome 'bin\tunnel-client.exe')
    )
    $found = Find-FirstFile $localCandidates
    if ($found) { return $found }

    Write-Step 'Download the official OpenAI tunnel-client for this Windows architecture'
    $architecture = if ([Environment]::Is64BitOperatingSystem -and $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $downloadRoot = Join-Path $AppHome 'bin'
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $headers = @{ 'User-Agent' = 'openclaw-chatgpt-bridge-setup'; 'Accept' = 'application/vnd.github+json' }
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/openai/tunnel-client/releases/latest' -Headers $headers -TimeoutSec 25
        $asset = $release.assets | Where-Object { $_.name -match ('^tunnel-client-' + [regex]::Escape($release.tag_name) + '-windows-' + $architecture + '\.zip$') } | Select-Object -First 1
        if (-not $asset) { throw "Could not find the official full-client Windows $architecture archive in release $($release.tag_name)." }
        $versionDir = Join-Path $downloadRoot $release.tag_name
        if (Test-Path -LiteralPath (Join-Path $versionDir 'tunnel-client.exe')) { return (Join-Path $versionDir 'tunnel-client.exe') }
        $zipPath = Join-Path $env:TEMP ([guid]::NewGuid().ToString() + '.zip')
        try {
            Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -TimeoutSec 120
            $expectedHash = $null
            if ([string]$asset.digest -match '^sha256:([A-Fa-f0-9]{64})$') {
                $expectedHash = $Matches[1].ToUpperInvariant()
            } else {
                $checksumAsset = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
                if ($checksumAsset) {
                    $checksumPath = Join-Path $env:TEMP ([guid]::NewGuid().ToString() + '.sha256.txt')
                    try {
                        Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath -TimeoutSec 30
                        $checksumText = Get-Content -LiteralPath $checksumPath -Raw
                        $checksumMatch = [regex]::Match($checksumText, '(?im)^([a-f0-9]{64})\s+\*?' + [regex]::Escape($asset.name) + '\s*$')
                        if ($checksumMatch.Success) { $expectedHash = $checksumMatch.Groups[1].Value.ToUpperInvariant() }
                    } finally { if (Test-Path $checksumPath) { Remove-Item -LiteralPath $checksumPath -Force } }
                }
            }
            if (-not $expectedHash) { throw 'Could not find a published SHA-256 checksum for the downloaded tunnel-client archive.' }
            $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
            if ($actualHash -ne $expectedHash) { throw 'The tunnel-client archive SHA-256 check failed. The archive will not be extracted.' }
            Write-Host 'Verified tunnel-client archive SHA-256 checksum.' -ForegroundColor Green
            $staging = Join-Path $downloadRoot ([guid]::NewGuid().ToString())
            New-Item -ItemType Directory -Path $staging | Out-Null
            Expand-Archive -LiteralPath $zipPath -DestinationPath $staging -Force
            $binary = Get-ChildItem -LiteralPath $staging -Filter 'tunnel-client.exe' -File -Recurse | Select-Object -First 1
            if (-not $binary) { Remove-Item -LiteralPath $staging -Recurse -Force; throw 'The official release archive did not contain tunnel-client.exe.' }
            if (Test-Path $versionDir) { Remove-Item -LiteralPath $versionDir -Recurse -Force }
            Move-Item -LiteralPath $staging -Destination $versionDir
            $binaryRelative = $binary.FullName.Substring($staging.Length).TrimStart('\')
            return (Join-Path $versionDir $binaryRelative)
        }
        finally { if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force } }
    }
    catch {
        Write-Warning ('Automatic download failed: ' + $_.Exception.Message)
        $manualPath = Read-Host 'Download the full Windows archive from https://github.com/openai/tunnel-client/releases/latest, extract it, and enter the full path to tunnel-client.exe'
        if (-not (Test-Path -LiteralPath $manualPath -PathType Leaf)) { throw 'A valid tunnel-client.exe path is required.' }
        return (Resolve-Path -LiteralPath $manualPath).Path
    }
}

if ($ValidateOnly) {
    Write-Step 'Validate source architecture and project scripts without changing configuration'
    $validationScript = Join-Path $RepoRoot 'tests\check-syntax.ps1'
    if (-not (Test-Path -LiteralPath $validationScript -PathType Leaf)) {
        throw "Validation script not found: $validationScript"
    }
    & $validationScript
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $package = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
    if ($package.engines.node -notmatch '20') { throw 'package.json does not declare Node.js 20+.' }
    Write-Host 'PASS package metadata' -ForegroundColor Green
    exit 0
}

Write-Step 'Prepare local configuration directory'
New-Item -ItemType Directory -Force -Path $AppHome, $SecretDir, $ProfileDir, $LogDir | Out-Null
Set-CurrentUserOnlyAcl -Path $SecretDir -IsDirectory $true
$config = $null
if (Test-Path -LiteralPath $ConfigFile) {
    try { $config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json } catch { Write-Warning 'Existing local config is invalid; a new configuration will be generated.' }
}

$betaRoot = Join-Path $env:LOCALAPPDATA 'OpenClawBeta'
$discoveredConfig = Find-FirstFile @(
    $config.openclawConfigPath,
    (Join-Path $betaRoot 'state\openclaw.json'),
    (Join-Path $env:USERPROFILE '.openclaw\openclaw.json'),
    (Join-Path $env:USERPROFILE '.openclaw\state\openclaw.json'),
    (Join-Path $env:LOCALAPPDATA 'OpenClaw\state\openclaw.json')
)
if (-not $OpenClawConfigPath) { $OpenClawConfigPath = Read-Default 'Path to openclaw.json' $discoveredConfig }
if (-not (Test-Path -LiteralPath $OpenClawConfigPath -PathType Leaf)) { throw "OpenClaw config not found: $OpenClawConfigPath" }
$OpenClawConfigPath = (Resolve-Path -LiteralPath $OpenClawConfigPath).Path
$stateDir = Split-Path -Parent $OpenClawConfigPath
$openClawRoot = if ((Split-Path -Leaf $stateDir) -eq 'state') { Split-Path -Parent $stateDir } else { $stateDir }

$nodeCandidates = @(
    $config.nodePath,
    (Join-Path $openClawRoot 'runtime\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'OpenClawBeta\runtime\node.exe'),
    (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
)
$NodePath = if ($NodePath) { $NodePath } else { Find-FirstFile $nodeCandidates }
if (-not $NodePath) { $NodePath = Read-Host 'Full path to node.exe (Node.js 20 or newer)' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js executable not found: $NodePath" }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$nodeVersion = (& $NodePath --version 2>&1 | Out-String).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) { throw "Node.js 20+ is required; found $nodeVersion." }

$globalNpmRoot = $null
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
    try { $globalNpmRoot = (& $npmCommand.Source root -g 2>$null | Select-Object -Last 1).Trim() } catch { $globalNpmRoot = $null }
}
$cliCandidates = @(
    $config.openclawCliPath,
    $(if ($globalNpmRoot) { Join-Path $globalNpmRoot 'openclaw\openclaw.mjs' }),
    $(if ($globalNpmRoot) { Join-Path $globalNpmRoot 'openclaw\bin\openclaw.js' }),
    (Join-Path $openClawRoot 'app\node_modules\openclaw\openclaw.mjs'),
    (Join-Path $env:LOCALAPPDATA 'OpenClawBeta\app\node_modules\openclaw\openclaw.mjs'),
    (Join-Path $env:APPDATA 'npm\node_modules\openclaw\openclaw.mjs'),
    (Join-Path $env:APPDATA 'npm\node_modules\openclaw\bin\openclaw.js')
)
if (-not $OpenClawCliPath) { $OpenClawCliPath = Find-FirstFile $cliCandidates }
if (-not $OpenClawCliPath) { $OpenClawCliPath = Read-Host 'Full path to OpenClaw CLI JavaScript entry point (openclaw.mjs or openclaw.js)' }
if (-not (Test-Path -LiteralPath $OpenClawCliPath -PathType Leaf)) { throw "OpenClaw CLI entry point not found: $OpenClawCliPath" }
$OpenClawCliPath = (Resolve-Path -LiteralPath $OpenClawCliPath).Path

try { $openClawSettings = Get-Content -LiteralPath $OpenClawConfigPath -Raw | ConvertFrom-Json } catch { throw 'openclaw.json is not valid JSON.' }
$gatewayDefault = if ($GatewayPort -gt 0) { [string]$GatewayPort } elseif ($config.gatewayPort) { [string]$config.gatewayPort } elseif ($openClawSettings.gateway.port) { [string]$openClawSettings.gateway.port } else { '18789' }
$GatewayPort = [int](Read-Default 'OpenClaw Gateway port' $gatewayDefault)
$BridgePort = [int](Read-Default 'Local bridge port' $(if ($config.bridgePort) { [string]$config.bridgePort } else { [string]$BridgePort }))
if ($BridgePort -lt 1024 -or $BridgePort -gt 65535 -or $GatewayPort -lt 1 -or $GatewayPort -gt 65535) { throw 'Gateway and bridge ports must be valid TCP ports.' }

if (-not $TunnelId) { $TunnelId = Read-Default 'Secure MCP Tunnel ID' ([string]$config.tunnelId) }
if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]{8,}$') { throw 'Tunnel ID format is invalid. Expected an ID beginning with tunnel_.' }

Write-Step 'Locate the official Secure MCP Tunnel client'
$tunnelClientPath = Get-OpenAiTunnelClient ([string]$config.tunnelClientPath)
$clientVersion = (& $tunnelClientPath --version 2>&1 | Out-String).Trim()
Write-Host "Using $clientVersion at $tunnelClientPath"

if ((Test-Path -LiteralPath $SecretFile) -and (Get-Item -LiteralPath $SecretFile).Length -gt 20) {
    $reuse = Read-Default 'Reuse the saved runtime API key? (Y/N)' 'Y'
    if ($reuse -notmatch '^(?i)y(es)?$') { Save-ApiKey }
} else { Save-ApiKey }
Set-CurrentUserOnlyAcl -Path $SecretFile

Write-Step 'Generate Secure MCP Tunnel profile'
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
& $tunnelClientPath init --profile $ProfileName --profile-dir $ProfileDir --tunnel-id $TunnelId --mcp-server-url "http://127.0.0.1:$BridgePort/mcp" --control-plane-api-key-ref "file:$SecretFile" --health-listen-addr "127.0.0.1:$TunnelHealthPort" --force
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ProfileFile)) { throw 'Could not create the tunnel-client profile.' }

$newConfig = [ordered]@{
    schemaVersion = 1
    openclawHome = $openClawRoot
    openclawConfigPath = $OpenClawConfigPath
    openclawStateDir = $stateDir
    openclawCliPath = $OpenClawCliPath
    nodePath = $NodePath
    gatewayPort = $GatewayPort
    bridgePort = $BridgePort
    bridgeHost = '127.0.0.1'
    agentId = if ($config.agentId) { [string]$config.agentId } else { 'main' }
    tunnelId = $TunnelId
    tunnelClientPath = $tunnelClientPath
    tunnelProfilePath = $ProfileFile
    tunnelProfileDir = $ProfileDir
    tunnelHealthPort = $TunnelHealthPort
    apiKeyPath = $SecretFile
    repoPath = $RepoRoot
    logDir = $LogDir
    configuredAt = (Get-Date).ToString('o')
}
$newConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigFile -Encoding UTF8
Set-CurrentUserOnlyAcl -Path $ConfigFile

Write-Step 'Validate local runtime configuration'
& $NodePath --check (Join-Path $RepoRoot 'src\server.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Bridge JavaScript syntax check failed.' }
& $tunnelClientPath doctor --config $ProfileFile --control-plane.api-key "file:$SecretFile" --explain
$doctorExit = $LASTEXITCODE
if ($doctorExit -ne 0) { Write-Warning 'tunnel-client doctor reported a problem; the local configuration was saved so it can be corrected with status.ps1 and the README troubleshooting section.' }

Write-Host "`nSetup saved. Local configuration: $ConfigFile" -ForegroundColor Green
Write-Host 'Next: run .\start.ps1 to start the bridge and tunnel, then open the local Overview.' -ForegroundColor Green
if ($doctorExit -ne 0) { exit $doctorExit }
