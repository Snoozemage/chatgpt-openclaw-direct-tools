import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { storeScreenshot, getScreenshot, clearScreenshots } from "../src/tools/computer/screenshot-store.mjs";
import { handleImageRenderTool } from "../src/tools/image-render/handler.mjs";
import { imageRenderToolDefinition, IMAGE_RENDER_RESOURCE_URI } from "../src/tools/image-render/schema.mjs";
import { toolDefinitions } from "../src/mcp/tool-definitions.mjs";

test("screenshot references are short opaque IDs and resolve only to cached image data", () => {
  clearScreenshots();
  const screenshotRef = storeScreenshot("aGVsbG8=", "image/jpeg");
  assert.match(screenshotRef, /^scr_[a-f0-9]{24}$/);
  assert.deepEqual(getScreenshot(screenshotRef).data, "aGVsbG8=");
  assert.equal(getScreenshot(screenshotRef).mimeType, "image/jpeg");
  assert.equal(getScreenshot("scr_not-a-reference"), null);
  clearScreenshots();
  assert.equal(getScreenshot(screenshotRef), null);
});

test("screenshot store rejects non-image MIME types", () => {
  assert.throws(() => storeScreenshot("data", "text/html"), /supported image MIME type/);
});

test("render tool exposes a UI resource and keeps screenshot bytes in _meta", async () => {
  clearScreenshots();
  const screenshotRef = storeScreenshot("aGVsbG8=", "image/png");
  const result = await handleImageRenderTool("openclaw_image_render", { screenshot_ref: screenshotRef });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.screenshot_ref, screenshotRef);
  assert.deepEqual(result._meta.imageRender, {
    screenshotRef,
    data: "aGVsbG8=",
    mimeType: "image/png",
  });
  assert.equal(imageRenderToolDefinition._meta.ui.resourceUri, IMAGE_RENDER_RESOURCE_URI);
  assert.ok(toolDefinitions.some((tool) => tool.name === "openclaw_image_render"));
  clearScreenshots();
});

test("viewer reads ChatGPT's hidden tool metadata and keeps its initial image hidden", async () => {
  const html = await readFile(new URL("../src/tools/image-render/viewer.html", import.meta.url), "utf8");
  assert.match(html, /toolResponseMetadata/);
  assert.match(html, /toolResponseMetadata\?\.mcp_tool_result\?\._meta\?\.imageRender/);
  assert.match(html, /width: 100%; height: auto; max-width: 100%/);
  assert.match(html, /border: 0; border-radius: 0/);
  assert.match(html, /notifyIntrinsicHeight\?\.\(document\.documentElement\.scrollHeight\)/);
  assert.doesNotMatch(html, /requestDisplayMode|fullscreen|id="preview"|id="expand"/);
  assert.doesNotMatch(html, /<h1|<header|<footer|Live capture|Screenshot ·|Click image|View full screen|Exit full screen|requestDisplayMode|fullscreen/);
  const script = html.split("<script>")[1]?.split("</script>")[0];
  assert.ok(script, "viewer script exists");
  assert.doesNotThrow(() => new Function(script));
});

test("render tool rejects missing, malformed, and expired references", async () => {
  clearScreenshots();
  const malformed = await handleImageRenderTool("openclaw_image_render", { screenshot_ref: "base64-data" });
  assert.equal(malformed.isError, true);
  const missing = await handleImageRenderTool("openclaw_image_render", { screenshot_ref: "scr_aaaaaaaaaaaaaaaaaaaaaaaa" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /not found or expired/);
  assert.equal(await handleImageRenderTool("unrelated", {}), undefined);
});

test("screenshot cache expires references", async () => {
  clearScreenshots();
  const screenshotRef = storeScreenshot("aGVsbG8=", "image/jpeg", { ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(getScreenshot(screenshotRef), null);
});
