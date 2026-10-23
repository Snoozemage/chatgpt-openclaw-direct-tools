$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$entryPoint = Join-Path $PSScriptRoot 'export.mjs'

$openClawHome = $env:OPENCLAW_HOME
if ([string]::IsNullOrWhiteSpace($openClawHome)) {
    $openClawHome = Join-Path $env:LOCALAPPDATA 'OpenClawBeta'
}

$nodeCandidates = @(
    $env:OPENCLAW_NODE_PATH
    (Join-Path $openClawHome 'runtime\node.exe')
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$runtimeNode = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $runtimeNode) {
    throw 'Node.js was not found. Set OPENCLAW_NODE_PATH or install Node.js.'
}

Set-Location -LiteralPath $repoRoot
& $runtimeNode $entryPoint @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
