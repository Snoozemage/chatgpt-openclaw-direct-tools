import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileGlob, globSearch, grepSearch } from "../src/tools/file-search/engine.mjs";
import { createFileSearchToolHandler } from "../src/tools/file-search/handler.mjs";
import { fileSearchToolDefinitions } from "../src/tools/file-search/schema.mjs";
import { toolDefinitions } from "../src/mcp/tool-definitions.mjs";

async function withFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openclaw-search-test-"));
  try {
    await mkdir(path.join(root, "src", "nested"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "ignored-package"), { recursive: true });
    await writeFile(path.join(root, "README.md"), "hello world\nsecond line\n");
    await writeFile(path.join(root, "src", "app.ts"), "const target = 123;\nother line\n");
    await writeFile(path.join(root, "src", "nested", "view.tsx"), "const target = 456;\n");
    await writeFile(path.join(root, "src", "nested", "notes.txt"), "Target appears here.\n");
    await writeFile(path.join(root, "node_modules", "ignored-package", "hidden.ts"), "const target = true;\n");
    await callback(await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("glob matcher supports globstar, single-level wildcards, brace alternatives, and character classes", () => {
  assert.equal(compileGlob("**/*.ts")("src/app.ts"), true);
  assert.equal(compileGlob("src/**/*.tsx")("src/nested/view.tsx"), true);
  assert.equal(compileGlob("*.{ts,tsx}")("app.ts"), true);
  assert.equal(compileGlob("src/[an]pp.ts")("src/app.ts"), true);
  assert.equal(compileGlob("src/*.ts")("src/nested/app.ts"), false);
  assert.equal(compileGlob("src/**/*.ts")("src/nested/app.ts"), true);
});

test("glob returns matching absolute paths, newest first, with a stable result limit", async () => withFixture(async (root) => {
  const old = new Date("2020-01-01T00:00:00Z");
  const newer = new Date("2022-01-01T00:00:00Z");
  await utimes(path.join(root, "src", "app.ts"), old, old);
  await utimes(path.join(root, "src", "nested", "view.tsx"), newer, newer);
  const result = await globSearch({ pattern: "src/**/*.{ts,tsx}", path: root });
  assert.deepEqual(result.matches.map((entry) => entry.path), [
    path.join(root, "src", "nested", "view.tsx"),
    path.join(root, "src", "app.ts"),
  ]);
  assert.equal(result.count, 2);
  assert.equal(result.truncated, false);
}));

test("glob fails cleanly on invalid paths and invalid input", async () => withFixture(async (root) => {
  await assert.rejects(() => globSearch({ pattern: "", path: root }), /pattern must be a non-empty string/);
  await assert.rejects(() => globSearch({ pattern: "*.ts", path: path.join(root, "absent") }), /does not exist or is not accessible/);
}));

test("grep returns line numbers and matching text, filters include patterns, and skips node_modules", async () => withFixture(async (root) => {
  const result = await grepSearch({ pattern: "target", path: root, include: "*.{ts,tsx}" });
  assert.equal(result.count, 2);
  assert.deepEqual(result.matches.map((match) => [path.basename(match.path), match.lineNumber]), [
    ["app.ts", 1],
    ["view.tsx", 1],
  ]);
  assert.equal(result.skippedBinaryFiles, 0);
}));

test("grep matches case-sensitively by line and can search a single file", async () => withFixture(async (root) => {
  const file = path.join(root, "src", "nested", "notes.txt");
  const result = await grepSearch({ pattern: "Target", path: file });
  assert.equal(result.count, 1);
  assert.equal(result.matches[0].path, file);
  assert.equal(result.matches[0].lineNumber, 1);
  assert.equal((await readFile(file, "utf8")).includes("Target"), true);
  assert.equal((await grepSearch({ pattern: "target", path: file })).count, 0);
}));

test("grep reports invalid regular expressions cleanly", async () => withFixture(async (root) => {
  await assert.rejects(() => grepSearch({ pattern: "[", path: root }), /not a valid JavaScript regular expression/);
}));

test("search handler exposes two independent MCP tools with read-only annotations", async () => {
  assert.deepEqual(fileSearchToolDefinitions.map((tool) => tool.name), ["openclaw_glob", "openclaw_grep"]);
  assert.ok(fileSearchToolDefinitions.every((tool) => tool.annotations.readOnlyHint === true));
  for (const tool of fileSearchToolDefinitions) {
    assert.ok(toolDefinitions.some((registered) => registered.name === tool.name));
  }
  const handler = createFileSearchToolHandler({
    searchFiles: async () => ({ pattern: "*.ts", root: "C:/repo", matches: [{ path: "C:/repo/a.ts" }], count: 1, totalMatchesFound: 1, truncated: false, scannedEntries: 2 }),
    searchContent: async () => ({ pattern: "hello", root: "C:/repo", matches: [{ path: "C:/repo/a.ts", lineNumber: 1, line: "hello", lineTruncated: false }], count: 1, truncated: false, scannedEntries: 2, scannedFiles: 1, skippedBinaryFiles: 0, skippedLargeFiles: 0 }),
  });
  assert.equal((await handler("openclaw_glob", { pattern: "*.ts" })).structuredContent.count, 1);
  assert.equal((await handler("openclaw_grep", { pattern: "hello" })).structuredContent.matches[0].lineNumber, 1);
  assert.equal(await handler("openclaw_read", { path: "file" }), undefined);
});

test("search handler returns actionable MCP errors and preserves unknown tool dispatch", async () => {
  const handler = createFileSearchToolHandler({ searchFiles: async () => { throw Object.assign(new Error("bad path"), { code: "SEARCH_PATH_UNAVAILABLE" }); } });
  const result = await handler("openclaw_glob", { pattern: "*.ts" });
  assert.equal(result.isError, true);
  assert.equal(result.diagnostics.code, "SEARCH_PATH_UNAVAILABLE");
  assert.match(result.content[0].text, /bad path/);
  assert.equal(await handler("unrelated", {}), undefined);
});
