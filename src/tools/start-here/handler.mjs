import { START_HERE_INSTRUCTIONS } from "../../mcp/instructions.mjs";
import { startHereToolDefinition } from "./schema.mjs";

export async function handleStartHereTool(name) {
  if (name !== startHereToolDefinition.name) return undefined;
  return { content: [{ type: "text", text: START_HERE_INSTRUCTIONS }] };
}
