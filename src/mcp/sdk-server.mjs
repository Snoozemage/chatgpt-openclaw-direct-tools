import { readFile } from "node:fs/promises";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { IMAGE_RENDER_RESOURCE_URI } from "../tools/image-render/schema.mjs";
import { beginToolEvent, finishToolEvent, publishMonitorSignal } from "../monitor/events.mjs";
import { callBridgeTool } from "./tool-dispatcher.mjs";
import { toolDefinitions } from "./tool-definitions.mjs";
import {
  getSessionSnapshot,
  isSessionInitialized,
  markSessionInitialized,
  markSessionTool,
  requestSessionId,
  setSessionTask,
} from "./session-registry.mjs";
import { buildMcpInstructions } from "./instructions.mjs";

const MAX_REQUEST_BODY_SIZE = 2 * 1024 * 1024;
const resourceMeta = {
  ui: { prefersBorder: false },
  "openai/widgetPrefersBorder": false,
  "openai/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" },
};

function createBridgeServer(requestInfo) {
  const server = new McpServer(
    { name: "openclaw-chatgpt-bridge", version: "0.1.0" },
    { instructions: buildMcpInstructions() },
  );
  const sessionKey = requestSessionId(requestInfo?.headers);

  for (const definition of toolDefinitions) {
    server.registerTool(
      definition.name,
      {
        ...(definition.title ? { title: definition.title } : {}),
        description: definition.description,
        inputSchema: fromJsonSchema(definition.inputSchema),
        ...(definition.annotations ? { annotations: definition.annotations } : {}),
        ...(definition._meta ? { _meta: definition._meta } : {}),
      },
      async (args, context) => {
        const sessionAtStart = markSessionTool(sessionKey, definition.name);
        if (sessionAtStart) publishMonitorSignal({ type: "session", session: sessionAtStart });
        const requestId = context?.mcpReq?.id ?? context?.requestId ?? "";
        const event = beginToolEvent(definition.name, args, requestId, sessionAtStart);

        try {
          let result;
          if (sessionKey && !isSessionInitialized(sessionKey) && definition.name !== "start_here") {
            result = {
              isError: true,
              content: [{
                type: "text",
                text: "INITIALIZATION_REQUIRED: This ChatGPT conversation has not been initialized. Call start_here first, follow the returned instructions, then retry this tool.",
              }],
            };
          } else {
            result = await callBridgeTool(definition.name, args);
          }

          if (definition.name === "start_here" && !result?.isError && sessionKey) {
            setSessionTask(sessionKey, args?.task);
            markSessionInitialized(sessionKey);
          }

          finishToolEvent(event, result, null, getSessionSnapshot(sessionKey));
          const updatedSession = getSessionSnapshot(sessionKey);
          if (updatedSession) publishMonitorSignal({ type: "session", session: updatedSession });
          return result ?? { content: [{ type: "text", text: "Tool returned no result." }] };
        } catch (error) {
          finishToolEvent(event, null, error, getSessionSnapshot(sessionKey));
          throw error;
        }
      },
    );
  }

  server.registerResource(
    "openclaw-screenshot-viewer",
    IMAGE_RENDER_RESOURCE_URI,
    {
      description: "Displays a screenshot returned by openclaw_image_render.",
      mimeType: "text/html;profile=mcp-app",
      _meta: resourceMeta,
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/html;profile=mcp-app",
        text: await readFile(new URL("../tools/image-render/viewer.html", import.meta.url), "utf8"),
        _meta: resourceMeta,
      }],
    }),
  );

  return server;
}

export const mcpHandler = createMcpHandler(
  ({ requestInfo }) => createBridgeServer(requestInfo),
  {
    legacy: "stateless",
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    onerror: (error) => console.error("MCP SDK handler error:", error),
  },
);