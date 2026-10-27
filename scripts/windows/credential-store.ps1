# Windows Credential Manager access adapted from OpenChatX's WindowsCredentialStore.
$credentialStoreType = 'OpenClawBridge.WindowsCredentialStore' -as [type]
if ($null -eq $credentialStoreType) {
    $credentialStoreSource = Join-Path $PSScriptRoot 'WindowsCredentialStore.cs'
    Add-Type -Path $credentialStoreSource -ErrorAction Stop
}
