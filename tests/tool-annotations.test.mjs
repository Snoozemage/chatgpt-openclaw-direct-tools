import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions } from "../src/mcp/tool-definitions.mjs";

test("public MCP tools declare accurate read-only and risk annotations", () => {
  const readOnlyNames = new Set(["openclaw_ls", "openclaw_read", "openclaw_image_render", "openclaw_glob", "openclaw_grep"]);
  const destructiveNames = new Set(["openclaw_edit", "openclaw_write", "openclaw_apply_patch", "openclaw_browser", "openclaw_computer"]);

  assert.equal(toolDefinitions.length, readOnlyNames.size + destructiveNames.size);
  for (const tool of toolDefinitions) {
    assert.ok(tool.annotations, `${tool.name} must declare MCP tool annotations`);
    assert.equal(tool.annotations.readOnlyHint, readOnlyNames.has(tool.name), `${tool.name} readOnlyHint`);
    assert.equal(tool.annotations.destructiveHint, destructiveNames.has(tool.name), `${tool.name} destructiveHint`);
    assert.equal(tool.annotations.openWorldHint, ["openclaw_browser", "openclaw_computer"].includes(tool.name), `${tool.name} openWorldHint`);
  }
});
