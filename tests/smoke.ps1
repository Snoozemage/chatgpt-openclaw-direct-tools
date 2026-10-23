[CmdletBinding()]
param([string]$BaseUrl = 'http://127.0.0.1:19002')

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$failures = [System.Collections.Generic.List[string]]::new()

function Assert-Check([bool]$Condition, [string]$Name, [string]$Details = '') {
    if ($Condition) {
        Write-Host ("PASS " + $Name) -ForegroundColor Green
        return
    }

    $message = if ($Details) { $Name + ': ' + $Details } else { $Name }
    Write-Host ("FAIL " + $message) -ForegroundColor Red
    $script:failures.Add($message)
}

function Send-Mcp([int]$Id, [string]$Method, [hashtable]$Params = @{}) {
    $body = @{ jsonrpc = '2.0'; id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 20
    Invoke-RestMethod -Uri ($script:base + '/mcp') -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 60
}

try {
    $health = Invoke-RestMethod -Uri ($base + '/healthz') -TimeoutSec 5
    Assert-Check ([bool]$health.ok) 'Bridge health endpoint'
} catch { Assert-Check $false 'Bridge health endpoint' $_.Exception.Message }

try {
    $initialized = Send-Mcp -Id 1 -Method 'initialize' -Params @{ protocolVersion = '2025-03-26'; capabilities = @{} }
    Assert-Check ($initialized.result.serverInfo.name -eq 'openclaw-direct-cdp-bridge') 'MCP initialize and server identity'
} catch { Assert-Check $false 'MCP initialize' $_.Exception.Message }

try {
    $listed = Send-Mcp -Id 2 -Method 'tools/list'
    $toolNames = @($listed.result.tools | ForEach-Object { $_.name })
    Assert-Check ($toolNames.Count -eq 1 -and $toolNames[0] -eq 'openclaw_browser') 'Only the Browser tool is publicly exposed'

    $definition = $listed.result.tools | Select-Object -First 1
    $schema = $definition.inputSchema
    $expectedActions = @('doctor','status','start','stop','profiles','importprofile','tabs','open','focus','close','snapshot','screenshot','navigate','console','requests','errors','text','emulate','pdf','download','waitfordownload','upload','dialog','act')
    $expectedKinds = @('batch','click','clickCoords','type','press','hover','scrollIntoView','drag','select','fill','resize','wait','evaluate','close')
    $missingActions = @($expectedActions | Where-Object { $_ -notin @($schema.properties.action.enum) })
    $missingKinds = @($expectedKinds | Where-Object { $_ -notin @($schema.properties.kind.enum) })
    Assert-Check ($missingActions.Count -eq 0 -and @($schema.properties.action.enum).Count -eq $expectedActions.Count) 'Browser schema exposes the native action vocabulary' ('Missing: ' + ($missingActions -join ', '))
    Assert-Check ($missingKinds.Count -eq 0 -and @($schema.properties.kind.enum).Count -eq $expectedKinds.Count) 'Browser schema exposes the native BrowserAct vocabulary' ('Missing: ' + ($missingKinds -join ', '))

    $schemaIsPermissive = @($schema.required) -contains 'action'
    $schemaIsPermissive = $schemaIsPermissive -and $schema.additionalProperties -eq $true
    $schemaIsPermissive = $schemaIsPermissive -and $null -eq $schema.anyOf -and $null -eq $schema.oneOf -and $null -eq $schema.allOf
    $schemaIsPermissive = $schemaIsPermissive -and $schema.properties.targetUrl.type -eq 'string'
    $schemaIsPermissive = $schemaIsPermissive -and $null -eq $schema.properties.targetUrl.format -and $null -eq $schema.properties.targetUrl.pattern
    $schemaIsPermissive = $schemaIsPermissive -and $schema.properties.fields.items.additionalProperties -eq $true
    Assert-Check $schemaIsPermissive 'Browser schema documents parameters without duplicating native payload validation'
    Assert-Check ($definition.description.Contains('does not duplicate Browser payload validation or rewrite supplied values')) 'Browser instructions explain native runtime ownership'
} catch { Assert-Check $false 'MCP tool schema' $_.Exception.Message }

try {
    $status = Send-Mcp -Id 3 -Method 'tools/call' -Params @{ name = 'openclaw_browser'; arguments = @{ action = 'status' } }
    $statusText = @($status.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
    Assert-Check ($null -ne $status.result -and -not $status.result.isError -and $statusText.Length -gt 0) 'Browser status action reaches live Gateway'
} catch { Assert-Check $false 'Browser status action' $_.Exception.Message }

try {
    $tabs = Send-Mcp -Id 7 -Method 'tools/call' -Params @{ name = 'openclaw_browser'; arguments = @{ action = 'tabs' } }
    $tabsText = @($tabs.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
    Assert-Check ($null -ne $tabs.result -and -not $tabs.result.isError -and $tabsText.Length -gt 0) 'Read-only tabs action returns live tab data'
} catch { Assert-Check $false 'Browser tabs action' $_.Exception.Message }

try {
    $profiles = Send-Mcp -Id 12 -Method 'tools/call' -Params @{ name = 'openclaw_browser'; arguments = @{ action = 'profiles' } }
    $profilesText = @($profiles.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
    Assert-Check ($null -ne $profiles.result -and -not $profiles.result.isError -and $profilesText.Contains('chrome')) 'Profiles action returns configured profiles'
} catch { Assert-Check $false 'Browser profiles action' $_.Exception.Message }

try {
    # Unsupported input should produce an OpenClaw response rather than a bridge_validation_error.
    $null = Send-Mcp -Id 4 -Method 'tools/call' -Params @{ name = 'openclaw_browser'; arguments = @{ action = '__not_a_browser_action__' } }
    $eventData = Invoke-RestMethod -Uri ($base + '/api/events') -TimeoutSec 5
    $event = @($eventData.events | Where-Object { $_.requestId -eq '4' }) | Select-Object -Last 1
    $eventJson = ConvertTo-Json -InputObject $event -Depth 20 -Compress
    $reachedGateway = $null -ne $event -and -not $eventJson.Contains('bridge_validation') -and (
        $null -ne $event.diagnostics.httpStatus -or $null -ne $event.diagnostics.elapsedMs
    )
    Assert-Check $reachedGateway 'Unsupported Browser action is handled by OpenClaw, not bridge validation'
} catch { Assert-Check $false 'Native error passthrough' $_.Exception.Message }

try {
    # Regression case: the bridge must not impose an HTTP(S)-only URL policy.
    $null = Send-Mcp -Id 6 -Method 'tools/call' -Params @{ name = 'openclaw_browser'; arguments = @{ action = 'open'; profile = 'user'; targetUrl = 'chrome://inspect/#remote-debugging' } }
    $eventData = Invoke-RestMethod -Uri ($base + '/api/events') -TimeoutSec 5
    $event = @($eventData.events | Where-Object { $_.requestId -eq '6' }) | Select-Object -Last 1
    $eventJson = ConvertTo-Json -InputObject $event -Depth 20 -Compress
    $reachedGateway = $null -ne $event -and -not $eventJson.Contains('bridge_validation') -and (
        $null -ne $event.diagnostics.httpStatus -or $null -ne $event.diagnostics.elapsedMs
    )
    Assert-Check $reachedGateway 'chrome://inspect is forwarded through the user profile to the native Browser runtime'
} catch { Assert-Check $false 'Internal Chrome URL passthrough' $_.Exception.Message }

try {
    $exportResponse = Invoke-WebRequest -UseBasicParsing -Uri ($base + '/api/events/export') -TimeoutSec 5
    $export = $exportResponse.Content | ConvertFrom-Json
    $countValid = $export.count -eq @($export.events).Count -and $export.count -le 200 -and $export.limit -eq 200
    $downloadHeaderValid = $exportResponse.Headers['Content-Disposition'] -match 'attachment; filename="openclaw-monitor-log-.*\.json"'
    Assert-Check ($exportResponse.StatusCode -eq 200 -and $downloadHeaderValid) 'Monitor export downloads JSON'
    Assert-Check $countValid 'Monitor export retains at most the 200 newest events'
} catch { Assert-Check $false 'Monitor export endpoint' $_.Exception.Message }

try {
    $monitorHtml = (Invoke-WebRequest -UseBasicParsing -Uri ($base + '/monitor') -TimeoutSec 5).Content
    Assert-Check ($monitorHtml.Contains('id="clear"') -and $monitorHtml.Contains('/api/events/clear')) 'Monitor UI exposes Clear'
    Assert-Check (-not $monitorHtml.Contains('confirm(')) 'Monitor Clear requires no confirmation dialog'
    $copyUiValid = $monitorHtml.Contains('id="copy"') -and $monitorHtml.Contains('Copy log') -and $monitorHtml.Contains('navigator.clipboard.writeText') -and $monitorHtml.Contains('copyHistory') -and -not $monitorHtml.Contains('id="export"')
    Assert-Check $copyUiValid 'Monitor UI copies events to clipboard'
    $independentScroll = $monitorHtml.Contains('height:calc(100vh - 68px);min-height:0;overflow:hidden') -and $monitorHtml.Contains('overflow-y:auto;overscroll-behavior:contain') -and $monitorHtml.Contains('height:100%;overflow-y:auto')
    Assert-Check $independentScroll 'Monitor event list and detail use independent scroll panes'
} catch { Assert-Check $false 'Monitor UI' $_.Exception.Message }

try {
    $beforeClear = Invoke-RestMethod -Uri ($base + '/api/events') -TimeoutSec 5
    $clearResult = Invoke-RestMethod -Uri ($base + '/api/events/clear') -Method Post -TimeoutSec 5
    $afterClear = Invoke-RestMethod -Uri ($base + '/api/events') -TimeoutSec 5
    $exportAfterClear = Invoke-WebRequest -UseBasicParsing -Uri ($base + '/api/events/export') -TimeoutSec 5
    $exportBody = $exportAfterClear.Content | ConvertFrom-Json
    Assert-Check ([bool]$clearResult.ok -and $clearResult.clearedCount -eq @($beforeClear.events).Count) 'Monitor Clear reports the number of removed events'
    Assert-Check (@($afterClear.events).Count -eq 0) 'Monitor history is empty after Clear'
    Assert-Check ($exportBody.count -eq 0 -and @($exportBody.events).Count -eq 0) 'Cleared events are absent from future exports'
} catch { Assert-Check $false 'Monitor Clear endpoint' $_.Exception.Message }

if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host ($failures.Count.ToString() + ' smoke test(s) failed.') -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'All smoke tests passed.' -ForegroundColor Green
exit 0
