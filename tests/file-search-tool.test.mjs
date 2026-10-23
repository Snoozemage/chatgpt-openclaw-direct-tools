import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRipgrepSearch, globSearch, grepSearch, MAX_GREP_FILE_BYTES } from "../src/tools/file-search/engine.mjs";
import { createFileSearchToolHandler } from "../src/tools/file-search/handler.mjs";
import { fileSearchToolDefinitions } from "../src/tools/file-search/schema.mjs";
import { toolDefinitions } from "../src/mcp/tool-definitions.mjs";

async function withFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openclaw-search-test-"));
  try {
    await mkdir(path.join(root, "src", "nested"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "ignored-package"), { recursive: true });
    await mkdir(path.join(root, ".git", "objects"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(root, "README.md"), "hello world\nsecond line\n");
    await writeFile(path.join(root, "ignored.txt"), "target should be ignored\n");
    await writeFile(path.join(root, "src", "app.ts"), "const target = 123;\nother line\n");
    await writeFile(path.join(root, "src", "nested", "view.tsx"), "const target = 456;\n");
    await writeFile(path.join(root, "src", "nested", "notes.txt"), "Target appears here.\n");
    await writeFile(path.join(root, "node_modules", "ignored-package", "hidden.ts"), "const target = true;\n");
    await writeFile(path.join(root, ".git", "objects", "hidden.ts"), "const target = true;\n");
    await writeFile(path.join(root, ".hidden.ts"), "const target = true;\n");
    await callback(await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("glob uses the built-in Node glob syntax and excludes .git and node_modules", async () => withFixture(async (root) => {
  const result = await globSearch({ pattern: "**/*.{ts,tsx}", path: root });
  assert.deepEqual(
    result.matches.map((entry) => path.relative(root, entry.path).split(path.sep).join("/")).sort(),
    ["src/app.ts", "src/nested/view.tsx"],
  );
  assert.equal(result.count, 2);
  assert.equal(result.truncated, false);
}));

test("glob returns matching absolute paths newest first", async () => withFixture(async (root) => {
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
}));

test("glob rejects empty, absolute, and parent-traversal patterns", async () => withFixture(async (root) => {
  await assert.rejects(() => globSearch({ pattern: "", path: root }), /pattern must be a non-empty string/);
  await assert.rejects(() => globSearch({ pattern: "../*.ts", path: root }), /must not contain '..' path segments/);
  await assert.rejects(() => globSearch({ pattern: path.join(root, "*.ts"), path: root }), /must be relative to the search root/);
  await assert.rejects(() => globSearch({ pattern: "*.ts", path: path.join(root, "absent") }), /does not exist or is not accessible/);
}));

test("grep invokes ripgrep, applies include globs, and respects standard ignore rules", async () => withFixture(async (root) => {
  const filtered = await grepSearch({ pattern: "target", path: root, include: "*.{ts,tsx}" });
  assert.deepEqual(
    filtered.matches.map((match) => [path.basename(match.path), match.lineNumber]).sort((a, b) => a[0].localeCompare(b[0])),
    [[".hidden.ts", 1], ["app.ts", 1], ["view.tsx", 1]],
  );
  assert.equal(filtered.count, 3);
  assert.equal(filtered.matches.some((match) => match.path.includes("node_modules")), false);

  const allFiles = await grepSearch({ pattern: "target", path: root });
  assert.deepEqual(allFiles.matches.map((match) => path.basename(match.path)).sort(), ["app.ts", "view.tsx"]);
}));

test("grep matches case-sensitively and can search a single file", async () => withFixture(async (root) => {
  const file = path.join(root, "src", "nested", "notes.txt");
  const result = await grepSearch({ pattern: "Target", path: file });
  assert.equal(result.count, 1);
  assert.equal(result.matches[0].path, file);
  assert.equal(result.matches[0].lineNumber, 1);
  assert.equal((await readFile(file, "utf8")).includes("Target"), true);
  assert.equal((await grepSearch({ pattern: "target", path: file })).count, 0);
}));

test("grep returns an empty result for ripgrep's no-match exit code", async () => withFixture(async (root) => {
  const result = await grepSearch({ pattern: "definitely-not-present", path: root });
  assert.equal(result.count, 0);
  assert.equal(result.truncated, false);
}));

test("grep reports invalid ripgrep regular expressions", async () => withFixture(async (root) => {
  await assert.rejects(
    () => grepSearch({ pattern: "[", path: root }),
    (error) => error.code === "SEARCH_INVALID_REGEX" && /regex parse error/i.test(error.message),
  );
}));

test("grep skips files above the 2 MiB safety limit", async () => withFixture(async (root) => {
  const file = path.join(root, "large.txt");
  const buffer = Buffer.alloc(MAX_GREP_FILE_BYTES + 128, 0x61);
  buffer.write("target", MAX_GREP_FILE_BYTES + 64, "ascii");
  await writeFile(file, buffer);
  const result = await grepSearch({ pattern: "target", path: file });
  assert.equal(result.count, 0);
}));

test("grep caps results and marks truncated output", async () => withFixture(async (root) => {
  const file = path.join(root, "many.txt");
  await writeFile(file, Array.from({ length: 140 }, (_, index) => "needle " + index).join("\n") + "\n");
  const result = await grepSearch({ pattern: "needle", path: file });
  assert.equal(result.count, 100);
  assert.equal(result.matches.length, 100);
  assert.equal(result.truncated, true);
}));

test("grep gives an actionable error when ripgrep is missing", async () => withFixture(async (root) => {
  const search = createRipgrepSearch({
    executable: path.join(root, "rg-that-does-not-exist.exe"),
  });
  await assert.rejects(
    () => search({ pattern: "target", path: root }),
    (error) => error.code === "SEARCH_RIPGREP_UNAVAILABLE" && /Install ripgrep/i.test(error.message),
  );
}));

test("search handler exposes two independent MCP tools with read-only annotations", async () => {
  assert.deepEqual(fileSearchToolDefinitions.map((tool) => tool.name), ["openclaw_glob", "openclaw_grep"]);
  assert.ok(fileSearchToolDefinitions.every((tool) => tool.annotations.readOnlyHint === true));
  assert.match(fileSearchToolDefinitions[0].description, /fs\/promises\.glob/);
  assert.match(fileSearchToolDefinitions[1].description, /ripgrep/);
  for (const tool of fileSearchToolDefinitions) {
    assert.ok(toolDefinitions.some((registered) => registered.name === tool.name));
  }
  const handler = createFileSearchToolHandler({
    searchFiles: async () => ({ pattern: "*.ts", root: "C:/repo", matches: [{ path: "C:/repo/a.ts" }], count: 1, totalMatchesFound: 1, truncated: false, scannedEntries: 2 }),
    searchContent: async () => ({ pattern: "hello", root: "C:/repo", matches: [{ path: "C:/repo/a.ts", lineNumber: 1, line: "hello", lineTruncated: false }], count: 1, truncated: false, scannedFiles: 1 }),
  });
  assert.equal((await handler("openclaw_glob", { pattern: "*.ts" })).structuredContent.count, 1);
  assert.equal((await handler("openclaw_grep", { pattern: "hello" })).structuredContent.matches[0].lineNumber, 1);
  assert.equal((await handler("openclaw_grep", { pattern: "hello" })).structuredContent.scannedFiles, 1);
  assert.equal(await handler("openclaw_read", { path: "file" }), undefined);
});

test("search handler returns actionable errors and preserves unknown tool dispatch", async () => {
  const handler = createFileSearchToolHandler({
    searchFiles: async () => { throw Object.assign(new Error("bad path"), { code: "SEARCH_PATH_UNAVAILABLE" }); },
  });
  const result = await handler("openclaw_glob", { pattern: "*.ts" });
  assert.equal(result.isError, true);
  assert.equal(result.diagnostics.code, "SEARCH_PATH_UNAVAILABLE");
  assert.match(result.content[0].text, /bad path/);
  assert.equal(await handler("unrelated", {}), undefined);
});
