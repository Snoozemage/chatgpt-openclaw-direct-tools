import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleMcpRequest } from "../src/mcp/request-handler.mjs";
import { isSessionInitialized, listSessions, removeSessionFromMonitor, requestSessionId, touchSession } from "../src/mcp/session-registry.mjs";
import { toolDefinitions } from "../src/mcp/tool-definitions.mjs";
import { readFile } from "node:fs/promises";

function request(payload, headers = {}) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return req;
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) { this.statusCode = statusCode; this.headers = headers; },
    end(body = "") { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

async function callTool(name, args = {}, session = "test-session") {
  const res = response();
  const headers = session ? { "x-openai-session": session } : {};
  await handleMcpRequest(request({
    jsonrpc: "2.0",
    id: Math.random().toString(36),
    method: "tools/call",
    params: { name, arguments: args },
  }, headers), res);
  return res.json();
}

test("prefers OpenAI conversation identity and supports documented header fallbacks", () => {
  assert.equal(requestSessionId({ headers: { "x-openai-session": "chat-a", "mcp-session-id": "mcp-a" } }), "chat-a");
  assert.equal(requestSessionId({ headers: { "mcp-session-id": "mcp-a" } }), "mcp-a");
  assert.equal(requestSessionId({ headers: { "x-openai-conversation-id": "chat-b" } }), "chat-b");
  assert.equal(requestSessionId({ headers: { "x-openai-session-id": "chat-c" } }), "chat-c");
  assert.equal(requestSessionId({ headers: { "x-openai-session": "x".repeat(600) } }), undefined);
});

test("start_here is the first exposed tool and has a compact optional task label", () => {
  assert.equal(toolDefinitions[0].name, "start_here");
  assert.deepEqual(toolDefinitions[0].inputSchema.required ?? [], []);
  assert.equal(toolDefinitions[0].inputSchema.properties.task.maxLength, 160);
});

test("a ChatGPT session must initialize before other tools and remains isolated from another session", async () => {
  const firstBlocked = await callTool("not_a_real_tool", {}, "chat-session-a");
  assert.equal(firstBlocked.result.isError, true);
  assert.match(firstBlocked.result.content[0].text, /INITIALIZATION_REQUIRED/u);

  const started = await callTool("start_here", { task: "session startup test" }, "chat-session-a");
  assert.equal(started.result.isError, undefined);
  assert.match(started.result.content[0].text, /Tool routing/u);

  const allowed = await callTool("not_a_real_tool", {}, "chat-session-a");
  assert.equal(allowed.result.isError, true);
  assert.match(allowed.result.content[0].text, /Unknown MCP tool/u);
  assert.doesNotMatch(allowed.result.content[0].text, /INITIALIZATION_REQUIRED/u);

  const secondBlocked = await callTool("not_a_real_tool", {}, "chat-session-b");
  assert.equal(secondBlocked.result.isError, true);
  assert.match(secondBlocked.result.content[0].text, /INITIALIZATION_REQUIRED/u);

  const sessions = listSessions();
  const first = sessions.find((session) => session.task === "session startup test");
  const second = sessions.find((session) => session.lastTool === "not_a_real_tool" && !session.initialized);
  assert.ok(first);
  assert.equal(first.initialized, true);
  assert.equal(first.id, "agent-1");
  assert.ok(second);
  assert.equal(second.initialized, false);
  assert.notEqual(first.id, second.id);
  assert.doesNotMatch(JSON.stringify(sessions), /chat-session-a|chat-session-b/u);
});

test("sessions without an identity remain compatible with local MCP clients", async () => {
  const result = await callTool("not_a_real_tool", {}, null);
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /Unknown MCP tool/u);
  assert.doesNotMatch(result.result.content[0].text, /INITIALIZATION_REQUIRED/u);
});

test("removing a session from the monitor preserves initialization and restores it on the next tool call", async () => {
  const sessionKey = "remove-from-monitor-session";
  await callTool("start_here", { task: "removable session test" }, sessionKey);
  const before = listSessions().find((session) => session.task === "removable session test");
  assert.ok(before);
  assert.equal(before.initialized, true);

  assert.equal(removeSessionFromMonitor(before.id), true);
  assert.equal(listSessions().some((session) => session.id === before.id), false);
  assert.equal(touchSession(sessionKey), undefined);
  assert.equal(isSessionInitialized(sessionKey), true);

  const laterCall = await callTool("not_a_real_tool", {}, sessionKey);
  assert.equal(laterCall.result.isError, true);
  assert.match(laterCall.result.content[0].text, /Unknown MCP tool/u);
  assert.doesNotMatch(laterCall.result.content[0].text, /INITIALIZATION_REQUIRED/u);

  const restored = listSessions().find((session) => session.id === before.id);
  assert.ok(restored);
  assert.equal(restored.initialized, true);
  assert.equal(restored.id, before.id);
});

test("monitor displays the session count only once inside the All sessions card", async () => {
  const html = await readFile(new URL("../src/monitor/index.html", import.meta.url), "utf8");
  assert.match(html, /ChatGPT Sessions<\/span><\/div>/u);
  assert.doesNotMatch(html, /id="sessionCount"/u);
  assert.match(html, /<span class="badge">'\+sessions\.length\+'<\/span>/u);
  assert.match(html, /data-remove-session=/u);
  assert.match(html, /fetch\("\/api\/sessions\/"/u);
  assert.doesNotMatch(html, /window\.confirm\(/u);
});
