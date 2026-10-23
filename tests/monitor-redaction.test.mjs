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
