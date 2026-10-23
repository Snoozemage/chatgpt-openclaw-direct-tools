import { browserToolDefinition } from "../tools/browser/schema.mjs";
import { computerToolDefinition } from "../tools/computer/schema.mjs";

// Assemble the public MCP tool list from the tool schemas.
export const toolDefinitions = [browserToolDefinition, computerToolDefinition];
