$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\windows\credential-store.ps1')

$target = 'OpenClawChatGPTBridge-Test-' + [guid]::NewGuid().ToString('N')
$firstSecret = 'test-secret-one-' + [guid]::NewGuid().ToString('N')
$secondSecret = 'test-secret-two-' + [guid]::NewGuid().ToString('N')

try {
    [OpenClawBridge.WindowsCredentialStore]::Save($target, $firstSecret)
    $loaded = [OpenClawBridge.WindowsCredentialStore]::Load($target)
    if ($loaded -cne $firstSecret) { throw 'Credential Manager read-back did not match the saved test value.' }

    [OpenClawBridge.WindowsCredentialStore]::Save($target, $secondSecret)
    $loaded = [OpenClawBridge.WindowsCredentialStore]::Load($target)
    if ($loaded -cne $secondSecret) { throw 'Credential Manager overwrite/read-back did not match the test value.' }

    if (-not [OpenClawBridge.WindowsCredentialStore]::Delete($target)) { throw 'Credential Manager did not delete the test entry.' }
    if ($null -ne [OpenClawBridge.WindowsCredentialStore]::Load($target)) { throw 'Deleted test credential is still present.' }

    Write-Host 'PASS Windows Credential Manager save, read, overwrite, and delete.' -ForegroundColor Green
}
finally {
    [void][OpenClawBridge.WindowsCredentialStore]::Delete($target)
    $loaded = $null
    $firstSecret = $null
    $secondSecret = $null
}
