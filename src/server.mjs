import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { host, port, gatewayPort } from "./config/runtime.mjs";
import { monitorEvents, eventClients, clearMonitorEvents, publishMonitorSignal } from "./monitor/events.mjs";
import { listSessions, removeSessionFromMonitor } from "./mcp/session-registry.mjs";
import { mcpHandler } from "./mcp/sdk-server.mjs";

const nodeMcpHandler = toNodeHandler(mcpHandler, {
  maxRequestBodySize: 2 * 1024 * 1024,
  onerror: (error) => console.error("MCP Node adapter error:", error),
});
const validateMcpHost = localhostHostValidation();
const validateMcpOrigin = localhostOriginValidation();
let restartPending = false;

const httpServer = createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", "http://" + (req.headers.host || (host + ":" + port))).pathname;
  if (req.method === "GET" && pathname === "/monitor") {
    try {
      const html = await readFile(new URL("./monitor/index.html", import.meta.url), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(html);
    } catch { sendJson(res, 500, { error: "Monitor UI could not be loaded." }); }
    return;
  }
  if (req.method === "GET" && pathname === "/api/events") {
    sendJson(res, 200, { events: monitorEvents.slice(-200) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/sessions") {
    sendJson(res, 200, { sessions: listSessions() });
    return;
  }
  const removeSessionMatch = req.method === "DELETE" && pathname.match(/^\/api\/sessions\/([^/]+)$/u);
  if (removeSessionMatch) {
    const sessionId = removeSessionMatch[1];
    if (!removeSessionFromMonitor(sessionId)) {
      sendJson(res, 404, { error: "Session not found." });
      return;
    }
    publishMonitorSignal({ type: "session_removed", sessionId });
    sendJson(res, 200, { ok: true, sessionId });
    return;
  }
  if (req.method === "POST" && pathname === "/api/events/clear") {
    const clearedCount = clearMonitorEvents();
    sendJson(res, 200, { ok: true, clearedCount, events: [] });
    return;
  }
  if (req.method === "GET" && pathname === "/api/events/export") {
    const events = monitorEvents.slice(-200);
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      limit: 200,
      count: events.length,
      sessions: listSessions(),
      events,
    }, null, 2);
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="openclaw-monitor-log-' + date + '.json"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(payload);
    return;
  }
  if (req.method === "GET" && pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": connected\n\n");
    eventClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(": keepalive\n\n"); }
      catch { clearInterval(heartbeat); eventClients.delete(res); }
    }, 15000);
    req.on("close", () => { clearInterval(heartbeat); eventClients.delete(res); });
    return;
  }
  if (req.method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, { ok: true, server: "openclaw-chatgpt-bridge", version: "0.1.0" });
    return;
  }
  if (pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" });
    res.end();
    return;
  }
  if (!validateMcpHost(req, res)) return;
  if (!validateMcpOrigin(req, res)) return;
  await nodeMcpHandler(req, res);
});

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

httpServer.listen(port, host, () => {
  console.log("OpenClaw MCP bridge listening at http://" + host + ":" + port + "/mcp");
  console.log("Health: http://" + host + ":" + port + "/healthz");
  console.log("Gateway: 127.0.0.1:" + gatewayPort);
});

function shutdown() {
  for (const client of eventClients) {
    try { client.end(); } catch {}
  }
  eventClients.clear();
  httpServer.close(() => {
    void mcpHandler.close().finally(() => process.exit(0));
  });
  httpServer.closeAllConnections?.();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
