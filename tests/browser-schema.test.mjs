import test from "node:test";
import assert from "node:assert/strict";
import { browserToolDefinition, BROWSER_ACTIONS, BROWSER_ACT_KINDS } from "../src/tools/browser/schema.mjs";

test("Browser schema exposes supported actions and only requires action", () => {
  const schema = browserToolDefinition.inputSchema;
  assert.equal(browserToolDefinition.name, "openclaw_browser");
  assert.deepEqual(schema.properties.action.enum, [...BROWSER_ACTIONS]);
  assert.deepEqual(schema.properties.kind.enum, [...BROWSER_ACT_KINDS]);
  assert.deepEqual(schema.required, ["action"]);
  assert.equal(schema.additionalProperties, true);
});

test("Browser schema keeps implementation details out of the public contract", () => {
  const schema = browserToolDefinition.inputSchema;
  assert.equal(schema.properties.profile, undefined);
  assert.equal(schema.properties.browser, undefined);
  assert.equal(schema.properties.systemProfile, undefined);
  assert.doesNotMatch(browserToolDefinition.description, /profile|systemProfile|timeout|extension|Gateway|selector/i);
  assert.ok(Buffer.byteLength(JSON.stringify(schema)) < 30_000);
});

test("BrowserAct parameter descriptions explain operation-specific inputs", () => {
  const schema = browserToolDefinition.inputSchema;
  assert.match(schema.properties.fields.description, /kind=fill.*ref and value/i);
  assert.match(schema.properties.key.description, /kind=press/i);
  assert.match(schema.properties.x.description, /clickCoords/i);
  assert.match(schema.properties.startRef.description, /drag/i);
  assert.match(schema.properties.stopOnError.description, /batch/i);
  assert.match(schema.properties.url.description, /kind=wait/i);
});

test("Browser description contains only essential usage guidance", () => {
  assert.equal(
    browserToolDefinition.description,
    "Control Chrome through OpenClaw. Use action=open or navigate with targetUrl; if Chrome is not running, use open to launch it and open the requested URL. Use snapshot before page interactions, then pass its refs to action=act."
  );
});
