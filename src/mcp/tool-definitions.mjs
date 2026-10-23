import { browserToolDefinition } from "../tools/browser/schema.mjs";
import { computerToolDefinition } from "../tools/computer/schema.mjs";
import { imageRenderToolDefinition } from "../tools/image-render/schema.mjs";

// Assemble the public MCP tool list from the tool schemas.
export const toolDefinitions = [browserToolDefinition, computerToolDefinition, imageRenderToolDefinition];
