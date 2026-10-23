# ChatGPT OpenClaw Direct Tools Bridge

A Windows MCP bridge connecting ChatGPT to an installed OpenClaw Gateway through the OpenAI Secure MCP Tunnel.

## Current scope

The bridge currently exposes one public MCP tool: `openclaw_browser`. Its schema defines the native Browser actions from the installed OpenClaw version and forwards requests to Gateway `/tools/invoke`. It does not delegate routine browser actions to the OpenClaw main agent for planning.

Browser control defaults to profile `chrome`, which uses the installed browser extension. The separate isolated `openclaw` browser profile should be selected explicitly only when intended. The native OpenClaw runtime remains authoritative: profile availability, extension attachment, permissions, and supported actions can still cause runtime errors, which are returned to the caller.

Additional native tools will be added one at a time. Each tool lives in a feature folder under `src/tools/<tool>/` with only the modules the feature actually needs; Browser uses a schema and a handler, with no parallel request validator. Register public schemas in `src/mcp/tool-definitions.mjs` and handlers in `src/mcp/tool-dispatcher.mjs`.

## Architecture

```text
ChatGPT custom MCP connector
        |
OpenAI Secure MCP Tunnel
        |
MCP bridge (Node.js)
        |
OpenClaw Gateway /tools/invoke
        |
Native OpenClaw Browser tool
```

The bridge also provides local health/status and call-monitoring endpoints. The monitor retains the 200 newest events, supports **Copy log**, and clears in-memory history through `POST /api/events/clear`. The Browser feature is grouped in `src/tools/browser/`: `schema.mjs` defines the MCP-facing action vocabulary and gives the model usage guidance; `handler.mjs` applies the documented default profile, invokes Gateway, and preserves native/runtime diagnostics. The bridge does not validate Browser payloads or rewrite supplied values; it only supplies the documented default profile when omitted. Its schema intentionally avoids duplicating action-specific runtime validation; OpenClaw decides whether a request is valid and whether its URL, key or action is supported. For `action=act`, pass `kind` and the fields used by that native operation, such as `fields` for `fill`. Use a snapshot before interacting with elements and use refs from that snapshot. The default profile is `chrome`; choose `openclaw` only when the isolated browser is intended.

## Repository structure

```text
chatgpt-openclaw-direct-tools/
|-- src/
|   |-- config/runtime.mjs
|   |-- openclaw-client.mjs
|   |-- mcp/
|   |   |-- tool-definitions.mjs
|   |   |-- tool-dispatcher.mjs
|   |   |-- format.mjs
|   |   `-- request-handler.mjs
|   |-- tools/
|   |   `-- browser/
|   |       |-- schema.mjs
|   |       `-- handler.mjs
|   |-- monitor/
|   |   |-- events.mjs
|   |   `-- index.html
|   `-- server.mjs
|-- tests/
|   |-- browser-schema.test.mjs
|   |-- check-syntax.ps1
|   `-- smoke.ps1
|-- setup.ps1
|-- start.ps1
|-- start-on-logon.ps1
|-- stop.ps1
|-- status.ps1
|-- start-monitor.ps1
`-- package.json
```
## Setup and operation

Requirements: Windows, PowerShell, and Node.js 20 or later. OpenClaw must be installed and configured. The bridge scripts use the configured OpenClaw CLI and Node runtime.

1. Run `npm run setup` and follow the prompts to configure the OpenClaw paths, bridge port, and Secure MCP Tunnel settings.
2. Run `npm start`. `start.ps1` starts the OpenClaw Gateway on the configured port if nothing is listening, then starts the MCP bridge and Secure MCP Tunnel client.
3. Check status with `npm run status`.
4. Configure the ChatGPT custom MCP connector to use the matching Secure MCP Tunnel, then start a new conversation and enable its tool.
5. Test with a read-only request, such as asking for browser status or the current tab list.

When `start.ps1` launches the Gateway itself, it saves the PID to `gateway.pid` and writes `gateway.stdout.log` / `gateway.stderr.log` under the local log directory. The script waits up to 300 seconds for the configured Gateway port and prints log details if startup fails. If something is already listening on that port, the script leaves that process untouched. For Windows sign-in startup, the scheduled task should call `start-on-logon.ps1`, which logs every attempt to `%LOCALAPPDATA%\OpenClawChatGPTBridge\logs\autostart.log` and retries once if startup fails. The logon trigger should include a short delay so the user session and OpenClaw files can finish initializing. The setup script keeps generated configuration, API-key material, tunnel profiles, and logs under `%LOCALAPPDATA%\OpenClawChatGPTBridge\`, outside this repository. The default bridge port is `19002` and the default tunnel health port is `8081`; setup may configure different values.

Use `npm stop` to stop processes managed by the scripts. It stops the Gateway only when `start.ps1` launched it and its recorded PID still matches the expected Node/OpenClaw command. Pre-existing Gateway processes are left running. The scripts `setup.ps1`, `start.ps1`, `stop.ps1`, and `status.ps1` can also be run directly from PowerShell.

## Validation

Run static checks, unit tests, and the live smoke suite:

```powershell
npm run check
npm run test:unit
npm test -- -BaseUrl http://127.0.0.1:19002
```

Unit tests cover the MCP schema and its usage guidance. The smoke suite checks live Gateway calls and verifies that `chrome://extensions` reaches the native Browser runtime without bridge-side payload validation. Neither suite proves that every native action will work in every runtime configuration.

## Security notes

- Keep the bridge bound to loopback; do not publicly expose the monitoring endpoints.
- Never commit local configuration, API keys, Gateway tokens, or generated tunnel profiles.
- Direct invocation is not a permission bypass. OpenClaw's runtime policy, browser profile and extension state, and product-level connector permissions still apply.
- Redaction is best-effort. Do not pass secrets as tool arguments.

## Related projects

- [chatgpt-web-agent](https://github.com/AxelHu/chatgpt-web-agent)
- [OpenClaw MCP Relay](https://docs.openclaw.ai/plugins/mcp-relay)
- [ClawConnect](https://github.com/lambda-curry/clawconnect)
