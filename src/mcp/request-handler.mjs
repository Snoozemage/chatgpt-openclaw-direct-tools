import { readFile } from "node:fs/promises";
import { toolDefinitions } from "./tool-definitions.mjs";
import { callBridgeTool } from "./tool-dispatcher.mjs";
import { IMAGE_RENDER_RESOURCE_URI } from "../tools/image-render/schema.mjs";
import { beginToolEvent, finishToolEvent, publishMonitorSignal } from "../monitor/events.mjs";
import { getSessionSnapshot, isSessionInitialized, markSessionInitialized, markSessionTool, requestSessionId, setSessionTask, touchSession } from "./session-registry.mjs";
import { MCP_INSTRUCTIONS } from "./instructions.mjs";

export function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
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
  const sessionKey = requestSessionId(req);
  const initialSession = touchSession(sessionKey);
  if (initialSession) publishMonitorSignal({ type: "session", session: initialSession });
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
  if (request.method.startsWith("notifications/")) { res.writeHead(202); res.end(); return; }
  if (!Object.prototype.hasOwnProperty.call(request, "id")) { sendJson(res, 202, {}); return; }

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
      case "ping": result = {}; break;
      case "tools/list": result = { tools: toolDefinitions }; break;
      case "resources/list":
        result = { resources: [{ uri: IMAGE_RENDER_RESOURCE_URI, name: "OpenClaw screenshot viewer", description: "Displays a screenshot returned by openclaw_image_render.", mimeType: "text/html;profile=mcp-app", _meta: { ui: { prefersBorder: false }, "openai/widgetPrefersBorder": false, "openai/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" } } }] };
        break;
      case "resources/read": {
        const uri = request.params?.uri;
        if (uri !== IMAGE_RENDER_RESOURCE_URI) {
          sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Unknown resource URI." } });
          return;
        }
        const html = await readFile(new URL("../tools/image-render/viewer.html", import.meta.url), "utf8");
        result = { contents: [{ uri: IMAGE_RENDER_RESOURCE_URI, mimeType: "text/html;profile=mcp-app", text: html, _meta: { ui: { prefersBorder: false }, "openai/widgetPrefersBorder": false, "openai/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" } } }] };
        break;
      }
      case "tools/call": {
        const target = request.params?.name;
        if (typeof target !== "string") {
          sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "tools/call requires params.name." } });
          return;
        }
        const toolArgs = request.params?.arguments || {};
        const sessionAtStart = markSessionTool(sessionKey, target);
        if (sessionAtStart) publishMonitorSignal({ type: "session", session: sessionAtStart });
        const event = beginToolEvent(target, toolArgs, request.id, sessionAtStart);
        try {
          if (sessionKey && !isSessionInitialized(sessionKey) && target !== "start_here") {
            result = { isError: true, content: [{ type: "text", text: "INITIALIZATION_REQUIRED: This ChatGPT conversation has not been initialized. Call start_here first, follow the returned instructions, then retry this tool." }] };
          } else result = await callBridgeTool(target, toolArgs);
          if (target === "start_here" && !result?.isError && sessionKey) {
            setSessionTask(sessionKey, toolArgs.task);
            markSessionInitialized(sessionKey);
          }
          finishToolEvent(event, result, null, getSessionSnapshot(sessionKey));
          const updatedSession = getSessionSnapshot(sessionKey);
          if (updatedSession) publishMonitorSignal({ type: "session", session: updatedSession });
        } catch (error) {
          finishToolEvent(event, null, error, getSessionSnapshot(sessionKey));
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
    sendJson(res, 200, { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
  }
}

export { requestSessionId } from "./session-registry.mjs";
