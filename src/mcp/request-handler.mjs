import { readFile } from "node:fs/promises";
import { toolDefinitions } from "./tool-definitions.mjs";
import { callBridgeTool } from "./tool-dispatcher.mjs";
import { IMAGE_RENDER_RESOURCE_URI } from "../tools/image-render/schema.mjs";
import { beginToolEvent, finishToolEvent } from "../monitor/events.mjs";

const MCP_INSTRUCTIONS = `# Agent Instructions\n\n## 1. Scope and precedence\n\n- Follow the most specific applicable project and file-level instructions.\n- Read documentation when it is relevant to the task; do not preload unrelated project docs.\n- Keep work scoped to the user's request. Do not expand it into unrelated refactoring or cleanup.\n- Preserve existing project locations, configuration, and unrelated user changes unless the task requires otherwise.\n- Do not guess when necessary information can be inspected.\n\n## 2. Autonomous execution\n\n- Work autonomously toward the user's requested outcome.\n- Continue past the first plausible implementation when inspection, validation, or follow-up fixes are needed.\n- Resolve routine implementation decisions from repository context instead of asking the user.\n- Inspect additional context when it materially affects correctness; avoid exploration without a task-driven reason.\n- Stop or ask for input only when a consequential decision cannot be resolved safely from the request or available evidence.\n- Do not treat a successful tool call as proof that the overall task is complete.\n\n## 3. Tool use\n\n- Use the most specific available tool that directly fits the operation.\n- Prefer dedicated tools over shell workarounds when dedicated tools exist.\n- Treat runtime tool schemas and descriptions as the source of truth for available arguments, constraints, and operation-specific procedures.\n- For file search, use openclaw_glob to find paths by pattern and openclaw_grep to search file contents with a regular expression; both return bounded results without shell command construction. These tools search project files, not the OpenClaw tool catalog.\n- For unwrapped OpenClaw capabilities, use openclaw_tool_search with concise English keywords, openclaw_tool_describe to inspect an exact schema, and openclaw_dispatch_action to invoke the selected tool. Prefer an existing direct bridge wrapper when it covers the operation; discovery intentionally omits those native tools to preserve wrapper-specific controls.\n- Use openclaw_exec to run commands and openclaw_process to inspect or control a command that returned a sessionId; preserve native execution policy and inspect actual results before reporting success.\n- Follow the instructions provided by each tool; do not assume capabilities that are not exposed.\n- Batch known paths or predictable, independent actions when supported.\n- Observe results before proceeding whenever the next action depends on the outcome of the previous one.\n- For browser or desktop interactions, inspect the current state before acting and re-observe after meaningful UI changes.\n- Use shell commands for genuine shell operations, builds, tests, Git, package managers, and process management—not as substitutes for dedicated file or search tools.\n- Choose descriptive identifiers for tool operations when an identifier is required.\n\n## 4. Context and output discipline\n\n- Scope repository inspection to what the task requires.\n- Protect the context window by narrowing file reads, searches, diffs, and command output to the relevant paths, patterns, ranges, or output limits.\n- Avoid unbounded file dumps, recursive searches, unrestricted diffs, and unnecessarily broad queries.\n- Prefer focused inspections and expand them only when the available evidence is insufficient.\n- Parallelize independent inspections or operations when doing so reduces latency without creating ordering hazards.\n- Keep user-facing progress updates short, factual, and useful. For multi-step tasks, report meaningful progress and continue without unnecessary pauses.\n\n## 5. File operations and code changes\n\n- Inspect the affected implementation, relevant callers, tests, configuration, and nearby contracts before changing behavior.\n- Read the current contents of existing files before editing them.\n- Use targeted edits for localized changes and whole-file writes only when intentional.\n- Use patches for coordinated multi-file changes, moves, or deletions when a suitable patch tool is available.\n- Make the smallest coherent change that fully satisfies the request.\n- Keep related behavior together and make ownership of state, configuration, and side effects clear.\n- Preserve unrelated user changes and avoid overwriting work that was not part of the task.\n- Do not add abstractions, wrappers, compatibility branches, or configuration options without a concrete need.\n- Do not preserve obsolete behavior solely because existing tests still reference it; update tests when the intended contract changes.\n\n## 6. Architecture and implementation quality\n\n- Prefer simple, cohesive designs with clear module boundaries.\n- Keep each protocol rule, persisted format, capability contract, error contract, and lifecycle invariant under a clear owner.\n- Prefer canonical representations over duplicated state that can become inconsistent.\n- Add abstractions only when they hide meaningful complexity, enforce invariants, or reduce repeated knowledge.\n- Validate external input at trust boundaries, then convert it into an internal representation the rest of the system can rely on.\n- Treat failure behavior as part of the public contract.\n- Return stable, actionable caller-facing errors while preserving internal causes for diagnostics.\n- Keep model-facing tool schemas explicit, compact, and compatible with the target MCP client.\n\n## 7. Validation and completion\n\n- Validate changes in proportion to their scope and risk.\n- Start with the narrowest meaningful checks, then broaden validation when failures, dependencies, or risk justify it.\n- Add or update regression tests for changed behavior and public contracts.\n- Validate actual model-facing MCP schemas and tool behavior, not only internal types or implementation code.\n- Run relevant tests, type checks, linters, builds, or other checks when they provide meaningful evidence.\n- Fix regressions introduced by the requested changes and repeat relevant checks.\n- Reinspect the final diff and resulting behavior when practical.\n- A task is complete when the requested outcome is implemented, relevant validation has been performed, and issues introduced by the requested changes have been addressed.\n- Report which checks actually ran and distinguish verified results from assumptions or unresolved issues.\n\n## 8. Safety and decision boundaries\n\n- Proceed with routine, reversible local work necessary to complete the request, including inspection, editing, and appropriate local validation.\n- Obtain approval before destructive, irreversible, externally consequential, or meaningfully costly actions when they are not clearly authorized by the request.\n- Use extra caution when an action affects production systems, external services, shared resources, credentials, or sensitive data.\n- Do not expose secrets or include them in logs, outputs, or generated artifacts unnecessarily.\n- Do not silently broaden the scope or impact of an operation.\n- If an operation fails, report the failure accurately; do not claim success without evidence.\n\n## 9. Communication\n\n- Communicate material findings, blockers, trade-offs, and completed results concisely.\n- For multi-step tasks, provide brief progress updates at meaningful stages and continue without unnecessary pauses.\n- Ask for clarification only when missing information or an unresolved decision materially affects safety or correctness.\n- Do not stop for confirmation at every routine implementation step.\n- Separate verified facts from assumptions, limitations, and recommendations.\n- Avoid filler, repetitive summaries, and stock AI phrasing.`;

export function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString("utf8");
    if (Buffer.byteLength(body, "utf8") > maxBytes) throw new Error("Request body exceeds the MCP bridge limit.");
  }
  return JSON.parse(body || "{}");
}

export async function handleMcpRequest(req, res) {
  let request;
  try {
    request = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (!request || Array.isArray(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    sendJson(res, 400, { error: "Expected one JSON-RPC 2.0 request object." });
    return;
  }
  if (request.method.startsWith("notifications/")) {
    res.writeHead(202);
    res.end();
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(request, "id")) {
    sendJson(res, 202, {});
    return;
  }

  try {
    let result;
    switch (request.method) {
      case "initialize": {
        const requested = request.params?.protocolVersion;
        result = {
          protocolVersion: typeof requested === "string" ? requested : "2025-03-26",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "openclaw-chatgpt-bridge", version: "0.1.0" },
          instructions: MCP_INSTRUCTIONS,
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: toolDefinitions };
        break;
      case "resources/list":
        result = {
          resources: [{
            uri: IMAGE_RENDER_RESOURCE_URI,
            name: "OpenClaw screenshot viewer",
            description: "Displays a screenshot returned by openclaw_image_render.",
            mimeType: "text/html;profile=mcp-app",
            _meta: {
              ui: { prefersBorder: false },
              "openai/widgetPrefersBorder": false,
              "openai/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" },
            },
          }],
        };
        break;
      case "resources/read": {
        const uri = request.params?.uri;
        if (uri !== IMAGE_RENDER_RESOURCE_URI) {
          sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Unknown resource URI." } });
          return;
        }
        const html = await readFile(new URL("../tools/image-render/viewer.html", import.meta.url), "utf8");
        result = {
          contents: [{
            uri: IMAGE_RENDER_RESOURCE_URI,
            mimeType: "text/html;profile=mcp-app",
            text: html,
            _meta: {
              ui: { prefersBorder: false },
              "openai/widgetPrefersBorder": false,
              "openai/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" },
            },
          }],
        };
        break;
      }
      case "tools/call": {
        const target = request.params?.name;
        if (typeof target !== "string") {
          sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "tools/call requires params.name." } });
          return;
        }
        const toolArgs = request.params?.arguments || {};
        const event = beginToolEvent(target, toolArgs, request.id);
        try {
          result = await callBridgeTool(target, toolArgs);
          finishToolEvent(event, result, null);
        } catch (error) {
          finishToolEvent(event, null, error);
          throw error;
        }
        break;
      }
      default:
        sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found: " + request.method } });
        return;
    }
    sendJson(res, 200, { jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    console.error("MCP request failed:", error);
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    });
  }
}
