import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OPEN_TIMEOUT_MS,
  isBrowserTimeout,
  outputContainsTargetUrl,
  prepareBrowserArgs,
} from "../src/tools/browser/recovery.mjs";

test("open gets a short default timeout while explicit timeout values are preserved", () => {
  assert.deepEqual(
    prepareBrowserArgs({ action: "open", targetUrl: "https://example.com" }),
    { action: "open", targetUrl: "https://example.com", profile: "chrome", timeoutMs: DEFAULT_OPEN_TIMEOUT_MS },
  );
  assert.equal(prepareBrowserArgs({ action: "open", timeoutMs: 30_000 }).timeoutMs, 30_000);
  assert.deepEqual(prepareBrowserArgs({ action: "doctor" }), { action: "doctor" });
});

test("timeout detection uses error wording, not the presence of a timeoutMs parameter", () => {
  assert.equal(isBrowserTimeout({ message: "tool execution failed", log: "browser timed out" }), true);
  assert.equal(isBrowserTimeout({ timeoutMs: 10_000, message: "invalid target" }), false);
});

test("open timeout recovery ignores URL fragments but does not match a different path", () => {
  const output = { content: [{ type: "text", text: 'tabs: [{"url":"https://example.com/page/#section"}]' }] };
  assert.equal(outputContainsTargetUrl(output, "https://example.com/page/"), true);
  assert.equal(outputContainsTargetUrl(output, "https://example.com/page"), false);
  assert.equal(outputContainsTargetUrl(output, "https://example.com/p"), false);
});

test("open timeout recovery supports Chrome internal URLs", () => {
  assert.equal(
    outputContainsTargetUrl({ content: [{ type: "text", text: "chrome://extensions" }] }, "chrome://extensions"),
    true,
  );
});
