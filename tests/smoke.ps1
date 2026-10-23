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
    Assert-Check ($initialized.result.serverInfo.name -eq 'openclaw-chatgpt-bridge') 'MCP initialize and server identity'
    $instructions = [string]$initialized.result.instructions
    $requiredInstructionSections = @(
        '## 1. Scope and precedence',
        '## 2. Autonomous execution',
        '## 3. Tool use',
        '## 4. Context and output discipline',
        '## 5. File operations and code changes',
        '## 6. Architecture and implementation quality',
        '## 7. Validation and completion',
        '## 8. Safety and decision boundaries',
        '## 9. Communication'
    )
    $missingInstructionSections = @($requiredInstructionSections | Where-Object { -not $instructions.Contains($_) })
    $instructionsStructured = $missingInstructionSections.Count -eq 0 -and $instructions.Contains('- Follow the most specific applicable') -and $instructions.Contains('- Validate actual model-facing MCP schemas')
    Assert-Check $instructionsStructured 'MCP initialization provides structured agent instructions' ('Missing sections: ' + ($missingInstructionSections -join ', '))
} catch { Assert-Check $false 'MCP initialize' $_.Exception.Message }

try {
    $listed = Send-Mcp -Id 2 -Method 'tools/list'
    $toolNames = @($listed.result.tools | ForEach-Object { $_.name })
    $expectedPublicToolNames = @('openclaw_browser', 'openclaw_computer', 'openclaw_image_render', 'openclaw_ls', 'openclaw_read', 'openclaw_edit', 'openclaw_write', 'openclaw_apply_patch', 'openclaw_glob', 'openclaw_grep', 'openclaw_exec', 'openclaw_process')
    $missingPublicToolNames = @($expectedPublicToolNames | Where-Object { $_ -notin $toolNames })
    $publicToolNamesValid = $toolNames.Count -eq $expectedPublicToolNames.Count -and $missingPublicToolNames.Count -eq 0
    Assert-Check $publicToolNamesValid 'All twelve public MCP tools are exposed' ('Missing: ' + ($missingPublicToolNames -join ', '))

    $globDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_glob' } | Select-Object -First 1
    $globSchemaValid = $null -ne $globDefinition -and @($globDefinition.inputSchema.required) -contains 'pattern' -and $globDefinition.annotations.readOnlyHint -eq $true
    Assert-Check $globSchemaValid 'Glob tool exposes a required pattern and read-only annotation'

    $grepDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_grep' } | Select-Object -First 1
    $grepSchemaValid = $null -ne $grepDefinition -and @($grepDefinition.inputSchema.required) -contains 'pattern' -and $grepDefinition.inputSchema.properties.include -and $grepDefinition.annotations.readOnlyHint -eq $true
    Assert-Check $grepSchemaValid 'Grep tool exposes regex and include parameters with a read-only annotation'

    $execDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_exec' } | Select-Object -First 1
    $execSchemaValid = $null -ne $execDefinition -and @($execDefinition.inputSchema.required) -contains 'command' -and $execDefinition.inputSchema.properties.workdir -and $execDefinition.annotations.openWorldHint -eq $true
    Assert-Check $execSchemaValid 'Exec tool exposes command/workdir and open-world annotation'

    $processDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_process' } | Select-Object -First 1
    $processSchemaValid = $null -ne $processDefinition -and @($processDefinition.inputSchema.required) -contains 'action' -and @($processDefinition.inputSchema.properties.action.enum) -contains 'poll' -and $processDefinition.annotations.openWorldHint -eq $true
    Assert-Check $processSchemaValid 'Process tool exposes action lifecycle and open-world annotation'

    $computerDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_computer' } | Select-Object -First 1
    $computerLifecycleValid = $null -ne $computerDefinition -and $computerDefinition.description.Contains('executionId') -and $computerDefinition.description.Contains('close_execution') -and $computerDefinition.description.Contains('Batch up to 5 predictable actions')
    Assert-Check $computerLifecycleValid 'Computer tool description documents the execution lifecycle'

    $renderDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_image_render' } | Select-Object -First 1
    $renderSchemaValid = $null -ne $renderDefinition -and @($renderDefinition.inputSchema.required) -contains 'screenshot_ref' -and $renderDefinition._meta.ui.resourceUri -eq 'ui://openclaw/image-render/v4.html'
    Assert-Check $renderSchemaValid 'Image Render tool declares its MCP App resource'

    $resources = Send-Mcp -Id 20 -Method 'resources/list'
    $viewerResource = $resources.result.resources | Where-Object { $_.uri -eq 'ui://openclaw/image-render/v4.html' } | Select-Object -First 1
    Assert-Check ($null -ne $viewerResource -and $viewerResource.mimeType -eq 'text/html;profile=mcp-app') 'Image viewer resource is discoverable'
    $viewerModes = @($viewerResource._meta.'openai/ui'.availableDisplayModes)
    $viewerPresentationValid = $null -ne $viewerResource -and $viewerResource._meta.ui.prefersBorder -eq $false -and $viewerModes.Count -eq 1 -and $viewerModes[0] -eq 'inline'
    Assert-Check $viewerPresentationValid 'Image viewer removes the host border and only supports inline display'
    $viewer = Send-Mcp -Id 21 -Method 'resources/read' -Params @{ uri = 'ui://openclaw/image-render/v4.html' }
    Assert-Check ($viewer.result.contents[0].text.Contains('id="screenshot"')) 'Image viewer resource returns HTML'

    $definition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_browser' } | Select-Object -First 1
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
    $browserGuidanceValid = $definition.description.Contains('Use snapshot before page interactions') -and $definition.description.Contains('pass its refs to action=act')
    Assert-Check $browserGuidanceValid 'Browser tool documents snapshot-first usage'

    $computerDefinition = $listed.result.tools | Where-Object { $_.name -eq 'openclaw_computer' } | Select-Object -First 1
    $computerSchema = $computerDefinition.inputSchema
    $expectedComputerActions = @('snapshot', 'close_execution', 'batch', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'mouse_move', 'left_click_drag', 'left_mouse_down', 'left_mouse_up', 'scroll', 'type', 'key', 'hold_key', 'list_apps', 'list_windows', 'get_accessibility_tree', 'get_cursor_position', 'get_window_state', 'launch_app', 'kill_app', 'bring_to_front', 'set_value', 'invoke_menu', 'zoom')
    $missingComputerActions = @($expectedComputerActions | Where-Object { $_ -notin @($computerSchema.properties.action.enum) })
    $computerSchemaValid = $null -ne $computerDefinition -and @($computerSchema.required) -contains 'action' -and $computerSchema.additionalProperties -eq $true
    $computerSchemaValid = $computerSchemaValid -and $missingComputerActions.Count -eq 0 -and @($computerSchema.properties.action.enum).Count -eq $expectedComputerActions.Count
    $computerSchemaValid = $computerSchemaValid -and $computerSchema.properties.executionId.pattern.StartsWith('^[0-9a-fA-F]{8}-')
    Assert-Check $computerSchemaValid 'Computer schema exposes desktop actions and execution lifecycle' ('Missing: ' + ($missingComputerActions -join ', '))
    $computerGuidanceValid = $computerDefinition.description.Contains('executionId') -and $computerDefinition.description.Contains('displayFrameId') -and $computerDefinition.description.Contains('close_execution') -and $computerDefinition.description.Contains('up to 5')
    $computerBatchSchemaValid = $computerSchema.properties.actions.maxItems -eq 5 -and @($computerSchema.properties.actions.items.properties.action.enum).Count -gt 0 -and $computerSchema.properties.stopOnError.type -eq 'boolean'
    Assert-Check ($computerGuidanceValid -and $computerBatchSchemaValid) 'Computer guidance documents execution lifecycle and sequential batch contract'
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
    $null = Send-Mcp -Id 6 -Method 'tools/call' -Params @{ name = 'openclaw_browser'; arguments = @{ action = 'open'; profile = 'chrome'; targetUrl = 'chrome://extensions' } }
    $eventData = Invoke-RestMethod -Uri ($base + '/api/events') -TimeoutSec 5
    $event = @($eventData.events | Where-Object { $_.requestId -eq '6' }) | Select-Object -Last 1
    $eventJson = ConvertTo-Json -InputObject $event -Depth 20 -Compress
    $reachedGateway = $null -ne $event -and -not $eventJson.Contains('bridge_validation') -and (
        $null -ne $event.diagnostics.httpStatus -or $null -ne $event.diagnostics.elapsedMs
    )
    Assert-Check $reachedGateway 'chrome://extensions is forwarded to the native Browser runtime'
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
