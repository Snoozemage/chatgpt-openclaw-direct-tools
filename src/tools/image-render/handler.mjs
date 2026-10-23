import { getScreenshot } from "../computer/screenshot-store.mjs";
import { imageRenderToolDefinition } from "./schema.mjs";

function errorResult(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export async function handleImageRenderTool(name, args = {}) {
  if (name !== imageRenderToolDefinition.name) return undefined;
  if (typeof args.screenshot_ref !== "string" || !/^scr_[a-f0-9]{24}$/.test(args.screenshot_ref)) {
    return errorResult("screenshot_ref must be a reference returned by openclaw_computer action=snapshot.");
  }
  const screenshot = getScreenshot(args.screenshot_ref);
  if (!screenshot) {
    return errorResult("Screenshot not found or expired. Take a fresh snapshot and call openclaw_image_render again.");
  }
  return {
    content: [{ type: "text", text: "Screenshot ready to render in the image viewer." }],
    structuredContent: {
      screenshot_ref: args.screenshot_ref,
      mimeType: screenshot.mimeType,
      createdAt: new Date(screenshot.createdAt).toISOString(),
    },
    _meta: {
      imageRender: {
        screenshotRef: args.screenshot_ref,
        data: screenshot.data,
        mimeType: screenshot.mimeType,
      },
    },
  };
}
