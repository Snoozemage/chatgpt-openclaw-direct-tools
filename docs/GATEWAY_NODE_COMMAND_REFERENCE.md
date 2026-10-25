# Gateway Node Command Reference

Use this reference when deciding which command IDs to add to `gateway.nodes.commands.allow` in `openclaw.json`.

This is a practical catalog, **not** a promise that every command exists on every installation. Node command availability depends on the OpenClaw version, node OS/device, enabled capabilities, paired command surface, and installed plugins. Always compare this reference with the commands advertised by the actual node.

## Three separate checks

A node command works only when all applicable checks pass:

1. **Declared:** the node (or its plugin) advertises the exact command ID.
2. **Approved:** the command is present in that node's approved pairing/command surface.
3. **Allowed by Gateway policy:** the command is in the platform defaults or `gateway.nodes.commands.allow`, and is not blocked by `gateway.nodes.commands.deny`.

For privacy-sensitive commands, the Gateway requires an explicit allowlist entry even if the node advertises the command. Adding an ID to `commands.allow` does not make an unsupported node implement that command, and does not approve a new pairing surface by itself.

## Use node capabilities through Tool Discovery

The native OpenClaw `nodes` tool is a general interface for capabilities exposed by paired nodes and their plugins; it is not limited to camera use. Depending on the installed OpenClaw version, node OS, hardware, pairing approvals, and enabled plugins, its actions may include:

- **Camera and media:** list cameras, capture a still image or clip, control supported PTZ cameras, retrieve recent photos.
- **Location:** retrieve device location, with the available accuracy and permission determined by the platform.
- **Screen and computer:** capture screenshots or screen recordings, and access related computer-control capabilities when supported.
- **Device information:** inspect device status, capabilities, permissions, and health.
- **Notifications:** list or interact with device notifications, and send system notifications.
- **Other node/plugin capabilities:** for example, local inference through Ollama or file-transfer operations where that node and plugin expose them.

This is a guide to capability categories, not a guarantee that every action exists on every node. Use Tool Discovery to check what the current runtime actually exposes:

1. Search with `openclaw_tool_search` using terms for the capability needed (for example, `location device location_get`, `screen snapshot recording`, or `camera list take photo`).
2. Pass the exact returned tool ID to `openclaw_tool_describe` to inspect its current schema and valid actions.
3. Call `openclaw_dispatch_action` with that exact ID and arguments matching the returned schema. Do not guess parameters or assume every action is supported.

### Availability and permission layers

- **Global tool policy:** `tools.alsoAllow` must include `"nodes"` alongside existing entries (for example, preserve `"computer"`). This exposes the broad `nodes` interface, not just one capability.
- **Gateway tool policy:** `gateway.tools.allow` must include `"nodes"`.
- **Node command policy:** the specific underlying command must be declared and approved by the target node, and must pass `gateway.nodes.commands.allow` / `gateway.nodes.commands.deny`. Privacy-sensitive actions may require explicit Gateway opt-in.
- **Platform consent:** camera, location, screen capture, notifications, and other device capabilities may require OS-level permissions or user consent.

On 2026-10-25, the discovery path was tested successfully on this setup: search and describe found `nodes`, `camera_list` returned the HP TrueVision HD Camera, and `camera_snap` captured a 640×360 JPEG. That test validates the general dispatch path; it does not imply that camera is the only supported use, or that every listed capability is enabled here.

Discovery action names can differ from underlying node command IDs; for example, the action `camera_snap` maps to the node command `camera.snap`. The bridge dispatch path must use the Gateway's supported `/tools/invoke` endpoint; the older CLI RPC route returned `Tool not available: nodes` even though `tools.effective` reported the tool as available.

## How to discover the right command

1. In **Settings → Advanced → Instances**, select the specific node and inspect its declared/approved commands. Names such as `camera.snap` are command IDs; they are not the same as Tool Discovery action names such as `camera_snap`.
2. From a terminal using the installed OpenClaw CLI, run:
   ```powershell
   openclaw nodes status --json
   openclaw nodes pending
   ```
   If the CLI is not on `PATH`, invoke the app-managed CLI using its full path or the Node.js runtime bundled with the app.
3. Add only the exact command ID you need to `gateway.nodes.commands.allow`. Preserve existing entries.
4. If the node announces a changed command surface, inspect `openclaw nodes pending`, approve the correct request with `openclaw nodes approve <requestId>`, and reconnect the node if prompted.
5. Test the command on that node. Use the command-specific schema/CLI help for required parameters; this document does not define every command's payload.

The Config UI presents `commands.allow` as a free-form string list rather than an On/Off toggle because the list can contain commands supplied by different platforms and plugins. A checkbox list would need to be generated from the commands actually declared by the connected node.

## Configure the allowlist in the OpenClaw app

You do not have to edit `openclaw.json` in a separate text editor. In the OpenClaw desktop app:

1. Open **Settings → Advanced → Config**.
2. In the Config search box, enter `gateway.nodes.commands.allow` and select **Gateway → Nodes → Commands**.
3. Under **Gateway Node Allowlist (Extra Commands)**, click **Add item** and enter the exact command ID, for example `camera.snap`.
4. Preserve every existing entry. Do not replace the entire array with a one-command example.
5. Click **Save Changes** and confirm the UI reports that the configuration was saved without validation errors.
6. If the node's declared commands changed, open **Settings → Advanced → Instances**, inspect the pending request, and approve the correct updated command surface. The CLI alternative is `openclaw nodes pending` followed by `openclaw nodes approve <requestId>`. Reconnect the node if the app or CLI indicates it is needed.
7. Verify the command in the selected node's command list and test it. Adding an ID to the Gateway allowlist alone does not grant a command the node has not declared or had approved.

The `commands.allow` field is a free-form list of exact command IDs, not an inventory of every command available on the current node. Use the discovery steps above to find the correct ID first. Only add privacy-sensitive commands when intentionally needed; `gateway.nodes.commands.deny` always takes precedence.

## Example: commands observed on this setup

On 2026-10-25, the connected Windows Node (node version `2026.9.8-1`) advertised the following commands after `camera.snap` was enabled and the updated command surface was approved:

- `browser.proxy`
- `camera.list`
- `camera.snap`
- `device.info`
- `device.status`
- `location.get`
- `ollama.chat`
- `ollama.models`
- `screen.snapshot`
- `system.execApprovals.get`
- `system.execApprovals.set`
- `system.notify`
- `system.run`
- `system.run.prepare`
- `system.which`

The separate `OpenClaw Windows CUA` node advertised `computer.act` and `screen.snapshot`. These are observed examples from this machine, not a default list to copy to another installation. Your actual node's live command list is authoritative.

## Privacy-sensitive commands that require explicit Gateway opt-in

These IDs are classified by the Gateway as dangerous or privacy-heavy. Add them only when the capability is intentionally needed.

| Command ID | Function | Notes |
|---|---|---|
| `camera.snap` | Capture a still photo from a node camera | Needs camera capability, OS consent where applicable, declared/approved command, and Gateway opt-in |
| `camera.clip` | Capture a short camera video clip | May include audio depending on payload/options; higher privacy impact than a still |
| `camera.ptz.control` | Control a supported pan/tilt/zoom camera | Requires compatible hardware |
| `screen.record` | Record the screen | Separate from a single screenshot |
| `contacts.add` | Add a contact | Personal-data mutation |
| `calendar.add` | Add a calendar event | Personal-data mutation |
| `reminders.add` | Add a reminder | Personal-data mutation |
| `health.summary` | Read health summary data | Sensitive health information |
| `sms.send` | Send an SMS | External side effect |
| `sms.search` | Search SMS data | Sensitive message data |

`gateway.nodes.commands.deny` takes precedence over both platform defaults and `commands.allow`.

## Built-in and platform command catalog

The lists below gather command IDs from the Gateway's built-in node policy. Availability is platform- and version-dependent; a command being listed here does not mean the target node supports it.

### Camera

| Command ID | Function | Typical availability / policy |
|---|---|---|
| `camera.list` | List available cameras | Built-in on some mobile/desktop node types; still requires node support and approval |
| `camera.snap` | Capture a still image | Explicit opt-in required |
| `camera.clip` | Capture a short video clip | Explicit opt-in required |
| `camera.ptz.status` | Read PTZ status | Available only where the platform/camera exposes PTZ status |
| `camera.ptz.control` | Move/control PTZ camera | Explicit opt-in required; compatible PTZ hardware needed |

### Browser, screen and computer control

| Command ID | Function | Typical availability / policy |
|---|---|---|
| `browser.proxy` | Proxy browser-control operations through a node | Desktop node command; generally admin-only at direct node invocation |
| `browser.proxy.upload.v1` | Browser proxy upload operation | Versioned desktop command; generally admin-only |
| `screen.snapshot` | Capture a still screenshot | Desktop/mobile support varies; Screen capability and OS permissions may apply |
| `screen.record` | Record screen video | Explicit opt-in required |
| `desktop.stream` | Stream a desktop session | Desktop-node feature; local sharing and policy still apply |
| `computer.act` | Interact with a computer UI | Requires the relevant computer-control capability and approved command surface |

### System execution and approvals

| Command ID | Function | Notes |
|---|---|---|
| `system.run` | Run a command on the node | High-impact; actual execution is also subject to node-local exec approvals |
| `system.run.prepare` | Prepare/inspect a system-run request | Node/system execution capability |
| `system.which` | Resolve an executable on the node | Node/system execution capability |
| `system.execApprovals.get` | Read node exec-approval settings | Approval administration |
| `system.execApprovals.set` | Change node exec-approval settings | Mutating security settings; use carefully |
| `system.notify` | Show/send a system notification | Notification support and OS policy apply |

**Important:** allowlisting `system.run` only permits that node command through Gateway policy. It does not automatically approve every shell command; node-local exec approval rules still apply.

### Device information and location

| Command ID | Function | Typical availability |
|---|---|---|
| `device.info` | Read device information | Supported mobile/desktop nodes |
| `device.status` | Read device status | Supported mobile/desktop nodes |
| `device.permissions` | Inspect device permissions | Platform-specific, commonly Android |
| `device.health` | Read device health information | Platform-specific, commonly Android |
| `device.apps` | Query/list device apps | Platform/plugin/version dependent |
| `location.get` | Read device location | Requires location capability and OS permission |

### Notifications, mobile UI and calls

| Command ID | Function | Typical availability |
|---|---|---|
| `notifications.list` | List device notifications | Platform-specific, commonly Android |
| `notifications.actions` | Act on a notification | Platform-specific, commonly Android |
| `watch.status` | Read paired Apple Watch status | iPhone/watch relay surface only |
| `watch.notify` | Send a notification through a paired Apple Watch | iPhone/watch relay surface only |
| `mobile.ui.observe` | Observe an Android UI | Requires compatible mobile UI/accessibility support |
| `mobile.ui.act` | Act on an Android UI | Requires compatible mobile UI/accessibility support |
| `callLog.search` | Search call-log data | Platform-specific; sensitive personal data |
| `talk.ptt.start` | Start push-to-talk | Requires a node advertising the Talk surface |
| `talk.ptt.stop` | Stop push-to-talk | Requires a node advertising the Talk surface |
| `talk.ptt.cancel` | Cancel push-to-talk | Requires a node advertising the Talk surface |
| `talk.ptt.once` | Send a one-shot push-to-talk action | Requires a node advertising the Talk surface |

### Personal data and media

| Command ID | Function | Typical availability / policy |
|---|---|---|
| `contacts.search` | Search contacts | Supported mobile platforms |
| `calendar.events` | Read calendar events | Supported mobile platforms |
| `reminders.list` | Read reminders | Supported platforms |
| `photos.latest` | Read latest photos/media | Supported platforms; payload and availability vary |
| `motion.activity` | Read motion/activity data | Platform-specific |
| `motion.pedometer` | Read pedometer data | Platform-specific |
| `contacts.add` | Add a contact | Explicit opt-in required |
| `calendar.add` | Add a calendar event | Explicit opt-in required |
| `reminders.add` | Add a reminder | Explicit opt-in required |
| `health.summary` | Read health summary | Explicit opt-in required |
| `sms.search` | Search SMS | Explicit opt-in required |
| `sms.send` | Send SMS | Explicit opt-in required |

### Files, transfer and terminal commands

These names may be exposed by a platform, node-host build or plugin; do not assume they exist on every Windows Node.

| Command ID | Function | Notes |
|---|---|---|
| `fs.listDir` | List a directory on a node | Direct node invocation may require administrator authority |
| `terminal.upload` | Transfer/upload terminal data | Versioned/platform-specific; direct invocation may require administrator authority |
| `file.fetch` | Fetch a file from a paired node | Optional node/plugin surface; file-transfer read policy also applies |
| `file.stat` | Read file metadata | Optional node/plugin surface |
| `file.write` | Write file bytes to a paired node | Optional node/plugin surface; file-transfer write policy also applies |
| `dir.list` | List a directory on a paired node | Optional node/plugin surface; file-transfer read policy also applies |
| `dir.fetch` | Fetch a directory tree from a paired node | Optional node/plugin surface; file-transfer read policy also applies |

File-transfer commands can have their own path policy (for example allowed read/write paths). Adding an ID to `commands.allow` alone does not bypass those path checks.

### Local inference / Ollama

| Command ID | Function | Typical availability |
|---|---|---|
| `ollama.models` | List models exposed by the node's Ollama service | Only if provided by that node build/plugin |
| `ollama.chat` | Run a chat/inference request through node Ollama | Only if provided by that node build/plugin |

### Other plugin-provided examples

Plugin node commands are not a closed global catalog: installing, enabling or disabling plugins can change which IDs are declared. Examples include:

| Command ID | Function / source |
|---|---|
| `mcp.tools.call.v1` | Call a tool exposed through an MCP bridge on a node, when supported/enabled |
| `agent.cli.claude.run.v1` | Claude CLI node integration, when the relevant plugin is installed and enabled |
| `codex.exec-server.stdio.v1` | Codex execution-server placement; requires its plugin and additional placement-specific approval |

For plugin-defined commands, inspect the plugin documentation and the node's actual declared command list before adding any ID. A guessed or stale command name will not make a tool available.

## Internal commands: do not add these to the public node allowlist

The Gateway package contains private worker-lifecycle commands, such as:

- `worker.bundle.install.v1`
- `worker.launch.v1`
- `worker.status.v1`
- `worker.cancel.v1`
- `worker.processes.v1`
- `worker.environment.stop.v1`
- `worker.workspace.exec.v1`
- `worker.workspace.prepare.v1`
- `worker.workspace.retain.v1`
- `worker.desktop.stream.v1`
- `worker.desktop.launch.v1`
- `worker.desktop.computer.v1`
- `worker.portal.stream.v1`

These are internal/private Gateway-worker protocol commands, not general-purpose node capabilities. Adding them to `gateway.nodes.commands.allow` does not make them public/invocable.

## Example: enable only still-photo capture

If the node declares and supports it, the minimal additional entry is:

```json5
{
  gateway: {
    nodes: {
      commands: {
        allow: [
          // Preserve any entries that already exist.
          "camera.snap"
        ]
      }
    }
  }
}
```

Do not replace an existing `allow` array with this example if it already contains other entries. Merge `camera.snap` into the current array. Do not add `camera.clip` or `screen.record` unless those separate capabilities are intentionally required.

## Sources and version caveat

This reference was assembled from the OpenClaw Gateway node-command policy and command constants, plus the public command-policy documentation. The installed Gateway and Windows Node versions can differ, and plugins extend the catalog. When the documentation and live runtime disagree, trust the actual node's declared commands, Gateway effective policy, and installed-version schema/CLI output.

- [Node command policy](https://github.com/openclaw/openclaw/blob/main/docs/nodes/command-policy.md)
- [Node troubleshooting](https://github.com/openclaw/openclaw/blob/main/docs/nodes/troubleshooting.md)
- [Gateway configuration reference](https://github.com/openclaw/openclaw/blob/main/docs/gateway/config-gateway.md)
- [Windows platform notes](https://github.com/openclaw/openclaw/blob/main/docs/platforms/windows.md)
