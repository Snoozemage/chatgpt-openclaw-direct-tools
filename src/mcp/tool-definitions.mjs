import { browserToolDefinition } from "../tools/browser/schema.mjs";
import { computerToolDefinition } from "../tools/computer/schema.mjs";
import { imageRenderToolDefinition } from "../tools/image-render/schema.mjs";
import { fileToolDefinitions } from "../tools/files/schema.mjs";
import { fileSearchToolDefinitions } from "../tools/file-search/schema.mjs";
import { runtimeToolDefinitions } from "../tools/runtime/schema.mjs";

// Assemble the public MCP tool list from the tool schemas.
export const toolDefinitions = [browserToolDefinition, computerToolDefinition, imageRenderToolDefinition, ...fileToolDefinitions, ...fileSearchToolDefinitions, ...runtimeToolDefinitions];
