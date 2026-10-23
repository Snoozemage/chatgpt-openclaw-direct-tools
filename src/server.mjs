import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { host, port, gatewayPort } from "./config/runtime.mjs";
import { monitorEvents, eventClients, clearMonitorEvents } from "./monitor/events.mjs";
import { sendJson, handleMcpRequest } from "./mcp/request-handler.mjs";

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
    sendJson(res, 200, { ok: true, server: "openclaw-direct-cdp-bridge", version: "0.1.0" });
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
  await handleMcpRequest(req, res);
});

httpServer.listen(port, host, () => {
  console.log("OpenClaw MCP bridge listening at http://" + host + ":" + port + "/mcp");
  console.log("Health: http://" + host + ":" + port + "/healthz");
  console.log("Gateway: 127.0.0.1:" + gatewayPort);
});
function shutdown() { httpServer.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
