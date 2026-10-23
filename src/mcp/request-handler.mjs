import { toolDefinitions } from "./tool-definitions.mjs";
import { callBridgeTool } from "./tool-dispatcher.mjs";
import { beginToolEvent, finishToolEvent } from "../monitor/events.mjs";

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
          capabilities: { tools: {} },
          serverInfo: { name: "openclaw-direct-cdp-bridge", version: "0.1.0" },
          instructions: "The public MCP surface currently exposes one per-tool module: openclaw_browser. It mirrors the full native browser action list available in this installed OpenClaw version; use action from its schema rather than discovering each action first. The profile defaults to user, OpenClaw’s built-in Chrome DevTools MCP attach to the existing signed-in Chrome session; the bridge does not use the Chrome extension by default. Pass profile=chrome explicitly for extension-based control, or profile=openclaw for the isolated browser. Existing-session mode has a smaller supported action set than the extension driver; prefer single-step actions and avoid batch, PDF export, download interception, and response-body retrieval in profile=user. For UI work, use snapshot and then act with refs from that same tab. Runtime errors are returned for troubleshooting. New tools will be grouped under src/tools/<tool>/ only after their native schema/routing is established.",
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: toolDefinitions };
        break;
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
