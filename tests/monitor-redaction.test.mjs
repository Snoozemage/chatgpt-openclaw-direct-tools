import test from "node:test";
import assert from "node:assert/strict";
import { beginToolEvent } from "../src/monitor/events.mjs";

test("monitor redacts sensitive argument fields", () => {
  const event = beginToolEvent("example", {
    api_key: "hidden-value",
    nested: { Authorization: "Bearer hidden-token" },
  }, "redaction-test-1");

  assert.equal(event.arguments.api_key, "[REDACTED]");
  assert.equal(event.arguments.nested.Authorization, "[REDACTED]");
});

test("monitor redacts API-key-like and bearer tokens in text", () => {
  const event = beginToolEvent("example", {
    command: "token sk-abcdefghijklmnopqrstuvwxyz012345 Bearer secret-value",
  }, "redaction-test-2");

  assert.equal(
    event.arguments.command,
    "token [REDACTED_API_KEY] Bearer [REDACTED]",
  );
});

test("monitor associates tool events with a safe session alias, not the raw session ID", () => {
  const event = beginToolEvent("openclaw_read", { filePath: "README.md" }, "redaction-test-3", {
    id: "agent-42",
    task: "read a file",
    initialized: true,
    status: "active",
  });

  assert.equal(event.sessionId, "agent-42");
  assert.equal(event.sessionLabel, "agent-42");
  assert.equal(event.sessionTask, "read a file");
  assert.equal(event.sessionInitialized, true);
  assert.equal(JSON.stringify(event).includes("secret-raw-session"), false);
});
