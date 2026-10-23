import test from "node:test";
import assert from "node:assert/strict";
import { browserToolDefinition, BROWSER_ACTIONS, BROWSER_ACT_KINDS } from "../src/tools/browser/schema.mjs";

test("Browser MCP schema exposes the installed native action vocabulary", () => {
  const schema = browserToolDefinition.inputSchema;
  assert.equal(browserToolDefinition.name, "openclaw_browser");
  assert.deepEqual(schema.properties.action.enum, [...BROWSER_ACTIONS]);
  assert.deepEqual(schema.properties.kind.enum, [...BROWSER_ACT_KINDS]);
  assert.deepEqual(schema.required, ["action"]);
});

test("Browser schema describes inputs without duplicating runtime validation", () => {
  const schema = browserToolDefinition.inputSchema;
  assert.equal(schema.additionalProperties, true);
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.allOf, undefined);
  assert.equal(schema.oneOf, undefined);
  assert.equal(schema.properties.targetUrl.type, "string");
  assert.equal(schema.properties.targetUrl.format, undefined);
  assert.equal(schema.properties.targetUrl.pattern, undefined);
  assert.match(schema.properties.targetUrl.description, /determined by OpenClaw and the browser/i);
  assert.equal(schema.properties.fields.items.required, undefined);
  assert.equal(schema.properties.fields.items.additionalProperties, true);
  assert.equal(schema.properties.actions.items.additionalProperties, true);
});

test("Browser schema gives actionable usage guidance for common operations", () => {
  const schema = browserToolDefinition.inputSchema;
  assert.match(browserToolDefinition.description, /does not validate Browser payloads or rewrite supplied values/i);
  assert.match(browserToolDefinition.description, /snapshot before interacting/i);
  assert.match(browserToolDefinition.description, /clickCoords uses x and y/i);
  assert.match(schema.properties.key.description, /Enter/);
  assert.match(schema.properties.targetUrl.description, /schemes/i);
  assert.ok(Buffer.byteLength(JSON.stringify(schema)) < 30_000);
});