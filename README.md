# ChatGPT OpenClaw Direct CDP Bridge (Experimental Branch)

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![Protocol: MCP](https://img.shields.io/badge/protocol-MCP-5B5BD6)](https://modelcontextprotocol.io/)

A Windows-focused Model Context Protocol (MCP) bridge that exposes native OpenClaw tools directly to ChatGPT through the OpenAI Secure MCP Tunnel. The current public tool, `openclaw_browser`, forwards browser operations to the installed OpenClaw Gateway without routing routine actions through the OpenClaw main agent.

The repository also includes Windows lifecycle scripts and a local call monitor for inspecting tool arguments, results, timing, and errors.

> **Experimental direct browser attach.** This branch changes the default from the Chrome extension profile to OpenClaw’s built-in Chrome DevTools MCP existing-session profile (`user`). The `main` branch remains the extension-based version. This branch is experimental and does not bypass OpenClaw permissions or Chrome’s remote-debugging consent.

---

## 1. Project Overview

This project provides a small, Windows-first integration layer between ChatGPT and a local OpenClaw installation. The intent is to keep the public MCP surface explicit and easy to troubleshoot while allowing each native tool to be added independently.

The bridge currently exposes **one public MCP tool: `openclaw_browser`**. Additional tools are intended to be introduced incrementally after their native contracts have been inspected.

### Core capabilities

- **Native Browser access** — forward Browser actions to OpenClaw Gateway's `/tools/invoke` endpoint.
- **Schema-led tool discovery** — expose the current Browser action and BrowserAct operation vocabulary to the MCP client.
- **Live call monitor** — inspect running, successful, and failed calls, including arguments, output, duration, and available diagnostics.
- **Windows lifecycle management** — configure, start, inspect, and stop bridge-related processes with PowerShell scripts.
- **Runtime diagnostics** — retain native tool errors and attach relevant Gateway log context when invocation fails.
- **Local configuration isolation** — keep generated configuration, tunnel profiles, API-key material, and logs outside the Git repository.

---

## 2. Architecture

```text
ChatGPT custom MCP connector
          |
OpenAI Secure MCP Tunnel
          |
Local Node.js MCP bridge
          |                      |
          |                      +--> Local call monitor
          |                           /monitor · /api/events · /events
          |
OpenClaw Gateway /tools/invoke
          |
Native OpenClaw Browser tool
          |
Chrome DevTools MCP (existing-session profile `user`)
```

The bridge serves MCP requests at `/mcp`, a health endpoint at `/healthz`, and the local monitor at `/monitor`. Tool-call events are streamed to the monitor over Server-Sent Events (SSE).

The Browser feature lives under `src/tools/browser/`. Its schema describes the MCP-facing contract, while its handler supplies the documented default profile and applies a **10-second default timeout** to `action: "open"` when the caller does not specify `timeoutMs`. Browser-specific payload validation remains the responsibility of the native OpenClaw runtime. If an open operation times out, the bridge checks the current tab list once; it reports success only if the requested URL is observed, and never retries the open automatically.

---

## 3. Browser Tool Behavior

The exposed tool is named `openclaw_browser`. It forwards native Browser actions through Gateway and returns runtime results or errors to the caller.

- The default browser profile is **`user`**, which attaches to the existing signed-in Chrome session through Chrome DevTools MCP and does not rely on the OpenClaw browser extension.
- Use **`profile: "chrome"`** only when testing the extension-based control path, or **`profile: "openclaw"`** for an isolated OpenClaw-managed browser.
- For page interaction, take a snapshot first and use element refs from that snapshot where appropriate.
- For `action: "act"`, supply the native `kind` and the relevant operation fields. For example, `fill` uses `fields`, while `press` uses `key`.
- URL schemes, action support, browser availability, and permissions remain controlled by OpenClaw and the browser runtime.

The `user` profile must be prepared once in Chrome: open `chrome://inspect/#remote-debugging`, enable remote debugging, then accept Chrome's attach-consent prompt when OpenClaw asks. OpenClaw attaches to Chrome; it does not launch the existing-session browser for you.

**Capability trade-off:** the existing-session Chrome DevTools MCP driver supports common tab, snapshot, navigation, and interaction workflows, but not every action available in the extension driver. In particular, batch actions, PDF export, download interception, and response-body retrieval require a managed/raw-CDP profile. This branch is a test of the direct attach path, not a guarantee of more capabilities than the extension.

The bridge does not silently rewrite caller-supplied arguments or claim that an operation succeeded when the native runtime reports an error.

---

## 4. Local Call Monitor

Open the local monitor at:

```text
http://127.0.0.1:19002/monitor
```

The port can differ if changed during setup.

The monitor provides:

- **Live call status** — running, completed, and failed calls.
- **Call details** — operation, arguments, output, elapsed time, and diagnostics when available.
- **Filtering** — view calls by status.
- **Copy log** — copy the newest monitor events as JSON.
- **Clear history** — clear the in-memory event history.
- **Bounded retention** — keep at most the 200 newest events in memory.

The monitor is intended for local development and troubleshooting. Redaction is best-effort, so do not pass secrets in tool arguments.

---

## 5. Repository Structure

```text
chatgpt-openclaw-direct-tools/
├── src/
│   ├── config/
│   │   └── runtime.mjs            # Runtime paths and Gateway configuration
│   ├── mcp/
│   │   ├── format.mjs             # MCP result formatting
│   │   ├── request-handler.mjs    # MCP protocol request handling
│   │   ├── tool-definitions.mjs   # Public tool schemas
│   │   └── tool-dispatcher.mjs    # Public tool routing
│   ├── monitor/
│   │   ├── events.mjs             # In-memory event stream
│   │   └── index.html             # Local monitor UI
│   ├── tools/
│   │   └── browser/
│   │       ├── handler.mjs        # Browser invocation handler and timeout recovery
│   │       ├── recovery.mjs       # Open timeout policy and tab-state reconciliation
│   │       └── schema.mjs         # Browser MCP schema
│   ├── openclaw-client.mjs        # Gateway and node invocation helpers
│   └── server.mjs                 # Local HTTP and MCP server
├── tests/
│   ├── browser-recovery.test.mjs
│   ├── browser-schema.test.mjs
│   ├── relay-input-epoch.test.mjs
│   ├── check-syntax.ps1
│   └── smoke.ps1
├── docs/
│   └── TOOL_EXPOSURE_PLAN.md
├── setup.ps1
├── start.ps1
├── start-on-logon.ps1
├── start-monitor.ps1
├── status.ps1
├── stop.ps1
├── package.json
└── README.md
```

Public schemas are registered in `src/mcp/tool-definitions.mjs`; their handlers are registered in `src/mcp/tool-dispatcher.mjs`. Each additional native tool should live under `src/tools/<tool>/` and include only the modules its implementation actually needs.

---

## 6. Requirements and Setup

### Requirements

- Windows and PowerShell.
- Node.js **20 or later**.
- An installed and configured OpenClaw runtime and Gateway.
- Chrome 144 or newer for the built-in `user` existing-session mode; remote debugging must be enabled in `chrome://inspect/#remote-debugging`.
- An OpenAI Secure MCP Tunnel configuration for the ChatGPT custom MCP connector.

### Configure the bridge

From PowerShell, run the setup wizard in the repository root:

```powershell
npm run setup
```

Follow the prompts to configure the OpenClaw paths, bridge and Gateway ports, tunnel settings, and required API-key material. The setup script validates the local runtime configuration and saves generated settings outside the repository.

The default local application directory is:

```text
%LOCALAPPDATA%\OpenClawChatGPTBridge\
```

It contains the generated configuration, restricted API-key file, tunnel profile, and runtime logs. These files should remain local and must not be committed.

---

## 7. Run and Operate

Start the bridge, Gateway when needed, and tunnel client:

```powershell
npm start
```

Check the configured processes and endpoints:

```powershell
npm run status
```

Stop the processes managed by the project scripts:

```powershell
npm stop
```

The stop script only stops a Gateway process when the launcher started it and the recorded PID still matches the expected command. A pre-existing Gateway process is left running.

For Windows sign-in startup, configure the scheduled task to call `start-on-logon.ps1`. This wrapper records startup attempts and retries once after a failure. The `start-monitor.ps1` script is retained as a compatibility alias for the combined launcher.

After startup, configure the ChatGPT custom MCP connector to use the matching Secure MCP Tunnel. Start a fresh conversation, enable the connector's tool, and begin with a low-risk request such as checking Browser status or listing tabs.

---

## 8. Validation

Run static checks and unit tests:

```powershell
npm run check
npm run test:unit
```

Run the live smoke suite against a running local bridge:

```powershell
npm test -- -BaseUrl http://127.0.0.1:19002
```

The static check validates JavaScript and PowerShell syntax and checks selected architecture and lifecycle contracts. Unit tests cover the Browser MCP schema and browser relay input-access regressions. The smoke suite exercises live bridge/Gateway behavior; it requires a working local runtime and may depend on the installed OpenClaw configuration.

A passing local test suite does not establish that every Browser action will work in every profile or runtime state.

---

## 9. Security and Operational Boundaries

- **Keep the bridge local.** It defaults to loopback; do not expose the bridge or monitor endpoints to an untrusted network.
- **Never commit secrets.** API keys, Gateway configuration, tunnel profiles, logs, and process PID files belong outside version control.
- **Treat monitor output as sensitive.** Arguments and results may contain page content or other private data even when best-effort redaction is applied.
- **Respect native permissions.** Direct MCP invocation is not a permission bypass. Existing-session control requires Chrome remote debugging to be enabled and Chrome's attach-consent prompt accepted. Because this mode acts inside the signed-in session, treat it as highly privileged.
- **Use explicit, incremental tool exposure.** Inspect each native tool's real contract before publishing its schema; preserve the runtime's errors rather than adding bridge-side guesses.

---

## 10. Related Projects

- [OpenClaw MCP Relay](https://docs.openclaw.ai/plugins/mcp-relay)
- [chatgpt-web-agent](https://github.com/AxelHu/chatgpt-web-agent)
- [ClawConnect](https://github.com/lambda-curry/clawconnect)
