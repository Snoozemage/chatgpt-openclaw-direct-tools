import test from "node:test";
import assert from "node:assert/strict";
import { computerToolDefinition, COMPUTER_ACTIONS } from "../src/tools/computer/schema.mjs";
import { handleComputerTool } from "../src/tools/computer/handler.mjs";

test("computer tool exposes desktop actions with snapshot-first guidance", () => {
  const schema = computerToolDefinition.inputSchema;
  assert.equal(computerToolDefinition.name, "openclaw_computer");
  assert.deepEqual(schema.properties.action.enum, [...COMPUTER_ACTIONS]);
  assert.deepEqual(schema.required, ["action"]);
  assert.equal(schema.additionalProperties, true);
  assert.match(computerToolDefinition.description, /desktop UI, not browser DOM/i);
  assert.ok(schema.properties.keys);
  assert.ok(schema.properties.windowRef);
});

test("snapshot routes to screen.snapshot and forwards only snapshot parameters", async () => {
  const calls = [];
  const result = await handleComputerTool("openclaw_computer", {
    action: "snapshot",
    screenIndex: 1,
    maxWidth: 1200,
    format: "png",
    x: 30,
    timeoutMs: 5000,
  }, {
    node: "test-node",
    invokeNodeCommand: async (...args) => { calls.push(args); return { content: [] }; },
  });

  assert.deepEqual(result, { content: [] });
  assert.deepEqual(calls, [["test-node", "screen.snapshot", { screenIndex: 1, maxWidth: 1200, format: "png" }, 5000]]);
});

test("desktop actions route to computer.act with action-specific parameters", async () => {
  const calls = [];
  await handleComputerTool("openclaw_computer", {
    action: "left_click",
    x: 320,
    y: 180,
    windowRef: "window-1",
    timeoutMs: 8000,
    text: "must not leak into click payload",
  }, {
    node: "test-node",
    invokeNodeCommand: async (...args) => { calls.push(args); return { content: [] }; },
  });

  assert.deepEqual(calls, [[
    "test-node",
    "computer.act",
    { action: "left_click", windowRef: "window-1", x: 320, y: 180 },
    8000,
    { refWidth: undefined },
  ]]);
});

test("unknown computer actions fail without invoking the node", async () => {
  let invoked = false;
  const result = await handleComputerTool("openclaw_computer", { action: "run_shell" }, {
    invokeNodeCommand: async () => { invoked = true; },
  });

  assert.equal(invoked, false);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unsupported desktop action/);
});

test("other tool names are ignored by the computer handler", async () => {
  assert.equal(await handleComputerTool("openclaw_browser", { action: "snapshot" }), undefined);
});
