import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSchemaExport,
  flattenCatalog,
  normalizeRuntimeTool,
} from "../scripts/devtools/openclaw-tool-schema-export/lib/schema-export.mjs";

const inputSchema = {
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["snapshot", "click"] },
    options: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  additionalProperties: false,
};

test("exports the exact runtime input and output schemas as JSON data", () => {
  const tool = {
    name: "sample_tool",
    label: "Sample Tool",
    description: "Test description",
    parameters: inputSchema,
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    execute() {
      throw new Error("Runtime implementation must not be copied or called.");
    },
  };

  const exported = normalizeRuntimeTool(tool);
  assert.deepEqual(exported.inputSchema, inputSchema);
  assert.deepEqual(exported.outputSchema, tool.outputSchema);
  assert.equal(exported.name, "sample_tool");
  assert.equal(exported.schemaStatus, "full-runtime-schema");
  assert.equal("execute" in exported, false);
  assert.doesNotThrow(() => JSON.stringify(exported));
});

test("rejects runtime tool definitions that do not have an exact input schema", () => {
  assert.throws(() => normalizeRuntimeTool({ name: "missing_schema" }), /no object input schema/i);
  assert.throws(() => normalizeRuntimeTool({ parameters: inputSchema }), /non-empty name/i);
});

test("flattens catalog groups without losing source and plugin ownership", () => {
  const flattened = flattenCatalog({
    groups: [{
      id: "plugin:browser",
      label: "Browser",
      source: "plugin",
      pluginId: "browser",
      tools: [{ id: "browser", label: "Browser", parameters: [{ name: "action", required: true }] }],
    }],
  });
  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].groupId, "plugin:browser");
  assert.equal(flattened[0].groupSource, "plugin");
  assert.equal(flattened[0].groupPluginId, "browser");
});

test("reports full schemas separately from catalog entries that only have summaries", () => {
  const bundle = buildSchemaExport({
    tools: [{
      name: "browser",
      description: "Browser runtime description. Compact catalog description is the displayed summary.",
      parameters: inputSchema,
    }],
    catalog: {
      profiles: [{ id: "full", label: "Full" }],
      groups: [
        {
          id: "plugin:browser",
          label: "Browser plugin",
          source: "plugin",
          pluginId: "browser",
          tools: [{ id: "browser", label: "Browser", description: "Compact catalog description" }],
        },
        {
          id: "core:web",
          label: "Web",
          source: "core",
          tools: [{ id: "web_search", label: "Web search", description: "Search the web" }],
        },
      ],
    },
    exportedAt: "2026-10-23T00:00:00.000Z",
    openclawVersion: "test-version",
    agentId: "main",
    factoryModule: "agent-tools-test.mjs",
  });

  assert.equal(bundle.summary.fullSchemaCount, 1);
  assert.equal(bundle.summary.runtimeToolCount, 1);
  assert.equal(bundle.summary.catalogEntryCount, 2);
  assert.equal(bundle.summary.catalogEntriesWithFullSchema, 1);
  assert.equal(bundle.summary.catalogEntriesWithoutFullSchema, 1);
  assert.equal(bundle.summary.allCatalogEntriesHaveFullSchema, false);
  assert.deepEqual(bundle.tools[0].inputSchema, inputSchema);
  assert.equal(bundle.tools[0].catalogMetadata.pluginId, "browser");
  assert.equal(bundle.catalogEntriesWithoutFullSchema[0].id, "web_search");
  assert.equal(bundle.catalogEntriesWithoutFullSchema[0].schemaStatus, "not-present-in-exported-runtime-surface");
  assert.equal("inputSchema" in bundle.catalogEntriesWithoutFullSchema[0], false);
  assert.match(bundle.summary.note, /not fabricated or inferred schemas/i);
  assert.doesNotThrow(() => JSON.stringify(bundle));
});

test("does not guess which source owns a duplicate catalog id when descriptions do not match", () => {
  const bundle = buildSchemaExport({
    tools: [{ name: "browser", description: "Browser plugin runtime", parameters: inputSchema }],
    catalog: {
      groups: [
        {
          id: "ui",
          label: "UI",
          source: "core",
          tools: [{ id: "browser", label: "Browser", description: "Unrelated browser profile setting" }],
        },
        {
          id: "plugin:browser",
          label: "Browser plugin",
          source: "plugin",
          pluginId: "browser",
          tools: [{ id: "browser", label: "Browser plugin", description: "Controls browser automation sessions" }],
        },
      ],
    },
  });

  assert.equal(bundle.tools[0].catalogMetadata, null);
  assert.equal(bundle.summary.catalogEntriesWithFullSchema, 0);
  assert.equal(bundle.summary.catalogEntriesWithoutFullSchema, 2);
});

test("refuses empty or duplicate runtime tool inventories", () => {
  assert.throws(() => buildSchemaExport({ tools: [] }), /zero tools/i);
  assert.throws(() => buildSchemaExport({
    tools: [
      { name: "duplicate", parameters: inputSchema },
      { name: "duplicate", parameters: inputSchema },
    ],
  }), /duplicate runtime tool name/i);
});
