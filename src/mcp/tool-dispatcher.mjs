import { handleBrowserTool } from "../tools/browser/handler.mjs";
import { handleComputerTool } from "../tools/computer/handler.mjs";
import { handleImageRenderTool } from "../tools/image-render/handler.mjs";

const handlers = [handleBrowserTool, handleComputerTool, handleImageRenderTool];

export async function callBridgeTool(name, args = {}) {
  for (const handler of handlers) {
    const result = await handler(name, args);
    if (result !== undefined) return result;
  }
  return { isError: true, content: [{ type: "text", text: "Unknown MCP tool: " + name }] };
}
