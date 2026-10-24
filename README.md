# ChatGPT OpenClaw Direct Tools Bridge

[![Node.js 22.17+](https://img.shields.io/badge/Node.js-22.17%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenClaw Integration](https://img.shields.io/badge/OpenClaw-Integration-FF6B35)](https://openclaw.ai/)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-MCP-5B5BD6)](https://modelcontextprotocol.io/)
[![Built for ChatGPT](https://img.shields.io/badge/Built%20for-ChatGPT-74AA9C?logo=openai&logoColor=white)](https://chatgpt.com/)

A Model Context Protocol (MCP) bridge that exposes OpenClaw browser, desktop, and file tools directly to ChatGPT through the OpenAI Secure MCP Tunnel, plus bridge-native screenshot rendering, local project search, and dynamic native-tool discovery. It exposes 16 public MCP tools: browser and computer control, five file-operation tools, image rendering, glob/grep search, exec/process, and the discovery trio (`openclaw_tool_search`, `openclaw_tool_describe`, and `openclaw_dispatch_action`) without routing routine actions through the OpenClaw main agent.

The repository also includes Windows lifecycle scripts and a local call monitor for inspecting tool arguments, results, timing, and errors.

> **Direct invocation, native authority.** The bridge forwards Browser requests and preserves OpenClaw runtime errors. It does not bypass OpenClaw permissions, extension attachment, profile availability, or runtime validation.

---

## 1. Project Overview

This project provides a small integration layer between ChatGPT and a local OpenClaw installation. The bridge is built on Node.js, with platform-specific lifecycle scripts kept separate so support for additional operating systems can be added without changing the public MCP tool surface. Windows is the currently documented and supported setup. The intent is to keep the public MCP surface explicit and easy to troubleshoot while allowing each native tool to be added independently.

The bridge exposes sixteen public MCP tools. Browser, Computer, and Files wrap their supported OpenClaw runtime tools; `openclaw_image_render`, `openclaw_glob`, and `openclaw_grep` are bridge-native capabilities; `openclaw_exec` and `openclaw_process` wrap OpenClaw's native runtime tools. The discovery trio searches the live effective tool catalog, returns exact schemas built by the installed runtime, and dispatches eligible unwrapped tools through the Gateway. It intentionally omits native tools already covered by bridge wrappers.

### Core capabilities

- **Native Browser access** — forward Browser actions to OpenClaw Gateway's `/tools/invoke` endpoint.
- **Desktop computer control** — invoke `computer.act` and `screen.snapshot` on the paired OpenClaw Windows computer node.
- **Schema-led tool discovery** — expose supported browser, desktop, and file-operation contracts to the MCP client.
- **Local project search** — `openclaw_glob` uses Node.js's built-in `fs/promises.glob()`; `openclaw_grep` invokes ripgrep (`rg`) directly with structured JSON output and reports matching lines and line numbers. Ripgrep respects standard ignore files such as `.gitignore`.
- **Live call monitor** — inspect running, successful, and failed calls, including arguments, output, duration, and available diagnostics.
- **Lifecycle management** — configure, start, inspect, and stop bridge-related processes through npm commands backed by platform-specific scripts.
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
Installed browser profile / extension
```

The bridge serves MCP requests at `/mcp`, a health endpoint at `/healthz`, and the local monitor at `/monitor`. Tool-call events are streamed to the monitor over Server-Sent Events (SSE). Browser calls go through the Gateway HTTP tool-invocation endpoint; desktop calls go through the paired node command interface.

The Browser feature lives under `src/tools/browser/`. Its schema describes the MCP-facing contract, while its handler supplies the documented default profile and applies a **10-second default timeout** to `action: "open"` when the caller does not specify `timeoutMs`. Browser-specific payload validation remains the responsibility of the native OpenClaw runtime. If an open operation times out, the bridge checks the current tab list once; it reports success only if the requested URL is observed, and never retries the open automatically.

---

## 3. Browser Tool Behavior

The exposed tool is named `openclaw_browser`. It forwards native Browser actions through Gateway and returns runtime results or errors to the caller.

- Profile-dependent browser actions are pinned internally to **`profile: "chrome"`**. The public schema omits `profile`, `browser`, and `systemProfile` selectors, and the backend strips them if supplied anyway, so callers cannot switch to another browser profile.
- If `action: "open"` is requested while Chrome is fully closed, the bridge launches Chrome using the last-used profile from the existing local Chrome User Data directory, then forwards the request. This preserves the user's normal profile and its existing sign-in state; it does not create a separate OpenClaw profile. The OpenClaw extension must already be installed in that Chrome profile and be able to connect.
- Automatic launch applies only to `action: "open"`. Other actions do not start Chrome automatically. If Chrome is already running, the bridge leaves it running and does not spawn another instance.
- For page interaction, take a snapshot first and use element refs from that snapshot where appropriate.
- For `action: "act"`, supply the native `kind` and the relevant operation fields. For example, `fill` uses `fields`, while `press` uses `key`.
- URL schemes, action support, browser availability, and permissions remain controlled by OpenClaw and the browser runtime.

The bridge removes caller-supplied profile selectors, pins profile-dependent actions to `chrome`, and supplies the default timeout for `action: "open"`. Other supported action arguments are forwarded without silent rewriting. It does not claim that an operation succeeded when the native runtime reports an error.

## 4. Desktop Computer Tool

The exposed tool is named `openclaw_computer`. Use `action: "snapshot"` to capture the current screen, then use `left_click`, `type`, `key`, `scroll`, `list_windows`, or accessibility actions as needed. The snapshot returns an `executionId` and `displayFrameId`; the bridge keeps that OpenClaw execution alive across MCP calls and reuses it for subsequent actions on the active desktop session. Pass the latest `displayFrameId` with coordinate-based actions and take a fresh snapshot after the screen changes. Use `action: "batch"` with an ordered `actions` array to execute up to 5 desktop actions sequentially in one MCP request. The LLM should batch only steps predictable from the latest observation and use a shorter batch when the next step depends on inspecting a changed screen; the five-step cap is a maximum, not a target. The bridge still invokes each native action separately, so batch reduces LLM/MCP round-trips but does not remove per-action Gateway latency. By default, a batch stops on the first error; set `stopOnError: false` to continue and receive per-action results. Nested batches and `close_execution` inside a batch are unsupported; if a batch includes `snapshot`, it must be the final action. Call `action: "close_execution"` when the interaction is complete; if the caller does not close it, the bridge closes an idle execution after five minutes. The handler routes screenshots to `screen.snapshot` and desktop actions to `computer.act`, filters arguments to the native fields supported by each action, and serializes desktop operations to prevent overlapping input sequences. The paired node configured by `OPENCLAW_COMPUTER_NODE` (default: `OpenClaw Windows CUA`) must be connected and approved. This tool controls desktop UI; use `openclaw_browser` for browser-tab and DOM-level interactions.

### Optional screenshot rendering in ChatGPT

A successful `openclaw_computer` call with `action: "snapshot"` preserves the image content for model vision and adds a short `screenshot_ref`. The bridge stores a copy in memory for up to five minutes (maximum 12 cached screenshots). Call `openclaw_image_render` with that reference only when the screenshot should be shown in the chat UI. The render tool attaches the registered `ui://openclaw/image-render/v4.html` MCP App and sends the image bytes as tool-result `_meta`, rather than asking the model to copy a long Base64 string. References expire on timeout, cache eviction, or bridge restart. Hosts that do not support MCP Apps may show only the text fallback.

---

## 5. Local Call Monitor

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
│   │   ├── instructions.mjs       # MCP and session-start instructions
│   │   ├── sdk-server.mjs         # MCP SDK server and tool registration
│   │   ├── session-registry.mjs   # Conversation-scoped session state
│   │   ├── tool-definitions.mjs   # Public tool schemas
│   │   └── tool-dispatcher.mjs    # Public tool routing
│   ├── monitor/
│   │   ├── events.mjs             # In-memory event stream
│   │   └── index.html             # Local monitor UI
│   ├── tools/
│   │   ├── browser/               # Browser invocation, recovery, and schema
│   │   ├── computer/              # Windows desktop control
│   │   ├── files/                 # Native OpenClaw file-tool wrappers
│   │   ├── image-render/          # Optional screenshot viewer
│   │   ├── file-search/           # Local glob and regex content search
│   │   ├── runtime/               # Native exec and process wrappers
│   │   └── tool-discovery/         # Search, describe, and dispatch unwrapped native tools
│   ├── openclaw-client.mjs        # Gateway and node invocation helpers
│   └── server.mjs                 # Local HTTP and MCP server
├── tests/
│   ├── browser-recovery.test.mjs
│   ├── browser-schema.test.mjs
│   ├── computer-tool.test.mjs
│   ├── relay-input-epoch.test.mjs
│   ├── check-syntax.ps1
│   └── smoke.ps1
├── scripts/
│   └── windows/
│       ├── setup.ps1
│       ├── start.ps1
│       ├── stop.ps1
│       ├── status.ps1
│       ├── start-on-logon.ps1
│       ├── start-monitor.ps1
│       └── bridge-supervisor.ps1
├── docs/
│   └── TOOL_EXPOSURE_GUIDE.md
├── package.json
└── README.md
```

Public schemas are registered in `src/mcp/tool-definitions.mjs`; their handlers are registered in `src/mcp/tool-dispatcher.mjs`. Each native tool lives under `src/tools/<tool>/` and includes only the modules its implementation needs.

---

## 6. Requirements and Setup

### Requirements

- Windows and PowerShell for the currently supported lifecycle scripts.
- Node.js **22.17 or later** (`fs/promises.glob()` is stable in this release line).
- npm (used by setup to install the locked Model Context Protocol SDK dependencies).
- ripgrep (`rg.exe`) available on `PATH`. You can set `OPENCLAW_RIPGREP_PATH` to an executable path when it is not on `PATH`.
- An installed and configured OpenClaw runtime and Gateway.
- An OpenAI Secure MCP Tunnel configuration for the ChatGPT custom MCP connector.

### Configure the bridge

From PowerShell, run the setup wizard in the repository root:

```powershell
npm run setup
```

Follow the prompts to configure the OpenClaw paths, bridge and Gateway ports, tunnel settings, and required API-key material. The setup script installs the locked MCP SDK dependencies with `npm ci`, validates the local runtime configuration, and saves generated settings outside the repository.

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

For Windows sign-in startup, configure the scheduled task to call `scripts/windows/start-on-logon.ps1`. This wrapper records startup attempts and retries once after a failure. The `scripts/windows/start-monitor.ps1` script is retained as a compatibility alias for the combined launcher.

The bridge runs as a child owned by `scripts/windows/bridge-supervisor.ps1`. Monitor restart exits that child; the supervisor starts a replacement and verifies `/healthz` against the new PID. The supervisor does not manage the OpenClaw Gateway or Secure MCP Tunnel. `scripts/windows/stop.ps1` signals the supervisor to stop before shutting down the rest of the stack.

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

The static check validates JavaScript and PowerShell syntax and checks selected architecture and lifecycle contracts. Unit tests cover MCP SDK initialization/session behavior, the Browser MCP schema, and browser relay input-access regressions. The smoke suite exercises live bridge/Gateway behavior; it requires a working local runtime and may depend on the installed OpenClaw configuration.

A passing local test suite does not establish that every Browser action will work in every profile or runtime state.

---

## 9. Security and Operational Boundaries

- **Keep the bridge local.** It defaults to loopback; do not expose the bridge or monitor endpoints to an untrusted network.
- **Never commit secrets.** API keys, Gateway configuration, tunnel profiles, logs, and process PID files belong outside version control.
- **Treat monitor output as sensitive.** Arguments and results may contain page content or other private data even when best-effort redaction is applied.
- **Respect native permissions.** Direct MCP invocation is not a permission bypass. OpenClaw policy, browser profile state, extension attachment, and connector permissions still apply.
- **Use explicit, incremental tool exposure.** Inspect each native tool's real contract before publishing its schema; preserve the runtime's errors rather than adding bridge-side guesses.

---

## 10. Related Projects

- [OpenClaw MCP Relay](https://docs.openclaw.ai/plugins/mcp-relay)
- [chatgpt-web-agent](https://github.com/AxelHu/chatgpt-web-agent)
- [ClawConnect](https://github.com/lambda-curry/clawconnect)
- [openchatx-mcp](https://github.com/XiaoPuOuO/openchatx-mcp)
