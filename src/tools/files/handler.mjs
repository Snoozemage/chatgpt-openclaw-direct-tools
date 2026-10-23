import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { agentId, invokeTimeoutMs, openclawCli, stateDir } from "../../config/runtime.mjs";
import { fileToolDefinitions } from "./schema.mjs";

const fileToolNames = new Set(fileToolDefinitions.map((definition) => definition.name));
const nativeToolNames = new Map([
  ["openclaw_ls", "ls"],
  ["openclaw_read", "read"],
  ["openclaw_edit", "edit"],
  ["openclaw_write", "write"],
  ["openclaw_apply_patch", "apply_patch"],
]);

let nativeFileToolsPromise;

async function createNativeFileToolMap() {
  const packageRoot = path.dirname(openclawCli);
  const distPath = path.join(packageRoot, "dist");
  const entries = await readdir(distPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^agent-tools-.*\.mjs$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  let factory = null;
  for (const name of candidates) {
    const modulePath = path.join(distPath, name);
    const source = await readFile(modulePath, "utf8");
    if (!source.includes("function createOpenClawCodingToolsAsync")
      || !source.includes("assembleOpenClawCodingTools(options")) continue;

    const imported = await import(pathToFileURL(modulePath).href);
    const candidate = imported.createOpenClawCodingToolsAsync ?? imported.n;
    if (typeof candidate === "function") {
      factory = candidate;
      break;
    }
  }

  if (!factory) {
    throw new Error(
      "Could not locate OpenClaw's internal tool factory in dist/agent-tools-*.mjs. "
      + "The installed OpenClaw build may have changed; file tools are unavailable rather than falling back to an unsupported Gateway call."
    );
  }

  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  if (!configPath) throw new Error("OPENCLAW_CONFIG_PATH is not configured.");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const tools = await factory({
    config,
    agentId,
    workspaceDir: process.env.OPENCLAW_WORKSPACE_DIR || path.join(stateDir, "workspace"),
    sessionKey: "agent:" + agentId + ":openclaw-file-tool-wrapper",
  });

  const byName = new Map(Array.isArray(tools) ? tools.map((tool) => [tool.name, tool]) : []);
  for (const nativeName of nativeToolNames.values()) {
    if (typeof byName.get(nativeName)?.execute !== "function") {
      throw new Error("OpenClaw runtime did not construct an executable native file tool: " + nativeName);
    }
  }
  return byName;
}

async function getNativeFileTool(name) {
  if (!nativeFileToolsPromise) {
    nativeFileToolsPromise = createNativeFileToolMap().catch((error) => {
      nativeFileToolsPromise = undefined;
      throw error;
    });
  }
  const tools = await nativeFileToolsPromise;
  const tool = tools.get(name);
  if (!tool) throw new Error("OpenClaw native file tool is not available: " + name);
  return tool;
}

function resultContent(result) {
  if (Array.isArray(result?.content)) return result.content;
  const payload = result?.details ?? result ?? { message: "OpenClaw native tool returned an empty result." };
  return [{ type: "text", text: JSON.stringify(payload, null, 2) }];
}

function structuredDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const { content: _content, ...metadata } = details;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function errorResponse(nativeTool, error, startedAt) {
  const diagnostics = {
    stage: "native_file_tool_execution",
    nativeTool,
    elapsedMs: Date.now() - startedAt,
    errorName: error?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
  return {
    isError: true,
    diagnostics,
    content: [{
      type: "text",
      text: JSON.stringify({ type: "native_file_tool_execution_error", ...diagnostics }, null, 2),
    }],
  };
}

export function createFileToolHandler({ resolveTool = getNativeFileTool } = {}) {
  async function executeOne(nativeToolName, args = {}) {
    const startedAt = Date.now();
    try {
      const tool = await resolveTool(nativeToolName);
      const preparedArgs = typeof tool.prepareArguments === "function"
        ? await tool.prepareArguments(args)
        : args;
      const result = await tool.execute(randomUUID(), preparedArgs ?? {}, AbortSignal.timeout(invokeTimeoutMs));
      if (result?.isError === true) {
        return {
          isError: true,
          diagnostics: {
            stage: "native_file_tool_execution",
            nativeTool: nativeToolName,
            elapsedMs: Date.now() - startedAt,
          },
          content: resultContent(result),
        };
      }

      const structuredContent = structuredDetails(result?.details);
      return {
        content: resultContent(result),
        ...(structuredContent ? { structuredContent } : {}),
        diagnostics: {
          stage: "native_file_tool_execution",
          nativeTool: nativeToolName,
          elapsedMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      return errorResponse(nativeToolName, error, startedAt);
    }
  }

  function batchInputError(nativeToolName, message) {
    return {
      isError: true,
      diagnostics: { stage: "argument_validation", nativeTool: nativeToolName },
      content: [{ type: "text", text: message }],
    };
  }

  return async function handleFileTool(name, args = {}) {
    if (!fileToolNames.has(name)) return undefined;

    const nativeToolName = nativeToolNames.get(name);
    const supportsBatch = name === "openclaw_ls" || name === "openclaw_read";
    if (supportsBatch && Object.prototype.hasOwnProperty.call(args, "requests")) {
      if (Object.keys(args).some((key) => key !== "requests")) {
        return batchInputError(nativeToolName, "For batch calls, put all per-item options inside requests and do not combine requests with single-operation arguments.");
      }
      if (!Array.isArray(args.requests) || args.requests.length < 1 || args.requests.length > 5) {
        return batchInputError(nativeToolName, "requests must contain between 1 and 5 items.");
      }
      for (let index = 0; index < args.requests.length; index += 1) {
        const request = args.requests[index];
        if (!request || typeof request !== "object" || Array.isArray(request)
          || typeof request.path !== "string" || request.path.trim().length === 0) {
          return batchInputError(nativeToolName, "Each requests item must be an object with a non-empty path; invalid item at index " + index + ".");
        }
      }

      const results = await Promise.all(args.requests.map(async (request) => ({
        path: request.path,
        ...(await executeOne(nativeToolName, request)),
      })));
      const content = [];
      for (const item of results) {
        content.push({
          type: "text",
          text: "=== " + item.path + (item.isError ? " (ERROR)" : "") + " ===",
        });
        content.push(...item.content);
      }
      const failedCount = results.filter((item) => item.isError === true).length;
      return {
        ...(failedCount > 0 ? { isError: true } : {}),
        content,
        structuredContent: {
          results: results.map((item) => ({
            path: item.path,
            isError: item.isError === true,
            ...(item.structuredContent ? { details: item.structuredContent } : {}),
            ...(item.diagnostics ? { diagnostics: item.diagnostics } : {}),
          })),
        },
        diagnostics: {
          stage: "native_file_tool_batch",
          nativeTool: nativeToolName,
          requestCount: results.length,
          failedCount,
        },
      };
    }

    return executeOne(nativeToolName, args);
  };
}

export const handleFileTool = createFileToolHandler();
