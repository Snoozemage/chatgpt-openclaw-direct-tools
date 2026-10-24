# Backward-compatible alias for the combined bridge and tunnel launcher.
& (Join-Path $PSScriptRoot 'start.ps1') @args
exit $LASTEXITCODE
