import test from "node:test";
import assert from "node:assert/strict";
import { fileToolDefinitions } from "../src/tools/files/schema.mjs";
import { createFileToolHandler } from "../src/tools/files/handler.mjs";
import { toolDefinitions } from "../src/mcp/tool-definitions.mjs";

const nativeNames = new Map([
  ["openclaw_ls", "ls"],
  ["openclaw_read", "read"],
  ["openclaw_edit", "edit"],
  ["openclaw_write", "write"],
  ["openclaw_apply_patch", "apply_patch"],
]);

test("file tools expose five independent schemas with native parameter contracts", () => {
  assert.deepEqual(fileToolDefinitions.map((tool) => tool.name), [...nativeNames.keys()]);
  for (const tool of fileToolDefinitions) {
    assert.ok(tool.inputSchema.properties);
    assert.match(tool.description, /OpenClaw|native/i);
    assert.ok(toolDefinitions.some((registered) => registered.name === tool.name));
  }

  const read = fileToolDefinitions.find((tool) => tool.name === "openclaw_read");
  assert.deepEqual(read.inputSchema.required, ["path"]);
  assert.equal(read.inputSchema.properties.offset.minimum, 1);
  assert.equal(read.inputSchema.properties.cursor.minimum, 0);
  assert.equal(read.inputSchema.properties.optional.const, true);

  const edit = fileToolDefinitions.find((tool) => tool.name === "openclaw_edit");
  assert.deepEqual(edit.inputSchema.required, ["path", "edits"]);
  assert.deepEqual(edit.inputSchema.properties.edits.items.required, ["oldText", "newText"]);

  assert.deepEqual(fileToolDefinitions.find((tool) => tool.name === "openclaw_write").inputSchema.required, ["path", "content"]);
  assert.deepEqual(fileToolDefinitions.find((tool) => tool.name === "openclaw_apply_patch").inputSchema.required, ["input"]);
});

test("each public file tool prepares arguments when required, then calls its native executor", async () => {
  const calls = [];
  const preparations = [];
  const handler = createFileToolHandler({
    resolveTool: async (nativeName) => ({
      prepareArguments: (args) => {
        preparations.push(nativeName);
        return { ...args, preparedBy: nativeName };
      },
      execute: async (callId, args, signal) => {
        calls.push({ nativeName, callId, args, signal });
        return { content: [{ type: "text", text: "ok" }], details: { nativeName, content: "duplicate output", nextAfter: "cursor" } };
      },
    }),
  });

  const sampleArgs = {
    openclaw_ls: { path: "C:\\repo", limit: 23, after: "file-a" },
    openclaw_read: { path: "C:\\repo\\README.md", offset: 4, limit: 20 },
    openclaw_edit: { path: "src\\app.mjs", edits: [{ oldText: "old", newText: "new" }] },
    openclaw_write: { path: "notes.txt", content: "complete content" },
    openclaw_apply_patch: { input: "*** Begin Patch\n*** End Patch" },
  };

  for (const [publicName, args] of Object.entries(sampleArgs)) {
    const result = await handler(publicName, args);
    assert.equal(result.content[0].text, "ok");
    assert.deepEqual(result.structuredContent, { nativeName: nativeNames.get(publicName), nextAfter: "cursor" });
    assert.equal(result.diagnostics.nativeTool, nativeNames.get(publicName));
  }

  assert.deepEqual(preparations, [...nativeNames.values()]);
  assert.deepEqual(calls.map(({ nativeName, args }) => ({ nativeName, args })), Object.entries(sampleArgs).map(([publicName, args]) => ({
    nativeName: nativeNames.get(publicName),
    args: { ...args, preparedBy: nativeNames.get(publicName) },
  })));
  for (const call of calls) {
    assert.match(call.callId, /^[0-9a-f-]{36}$/i);
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test("read forwards native image content without dropping image blocks", async () => {
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
  const handler = createFileToolHandler({
    resolveTool: async () => ({ execute: async () => ({ content: [{ type: "text", text: "image read" }, image] }) }),
  });
  const result = await handler("openclaw_read", { path: "image.png" });
  assert.deepEqual(result.content, [{ type: "text", text: "image read" }, image]);
});

test("native executor errors are returned as MCP errors with diagnostics", async () => {
  const handler = createFileToolHandler({
    resolveTool: async () => {
      throw new Error("OpenClaw runtime unavailable");
    },
  });
  const result = await handler("openclaw_ls", { path: "." });
  assert.equal(result.isError, true);
  assert.equal(result.diagnostics.stage, "native_file_tool_execution");
  assert.equal(result.diagnostics.nativeTool, "ls");
  assert.match(result.content[0].text, /OpenClaw runtime unavailable/);
});

test("native tool failures stay MCP errors and preserve native content", async () => {
  const handler = createFileToolHandler({
    resolveTool: async () => ({
      execute: async () => ({
        isError: true,
        content: [{ type: "text", text: "Path does not exist" }],
      }),
    }),
  });
  const result = await handler("openclaw_read", { path: "missing.txt" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Path does not exist/);
});

test("file handler leaves unrelated tool names untouched", async () => {
  const handler = createFileToolHandler({ resolveTool: async () => assert.fail("must not resolve a tool") });
  assert.equal(await handler("openclaw_browser", { action: "snapshot" }), undefined);
});
