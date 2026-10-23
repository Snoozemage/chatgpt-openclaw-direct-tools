import { invokeGatewayTool, getRecentGatewayToolErrorLog } from "../../openclaw-client.mjs";
import { normalizeToolOutput } from "../../mcp/format.mjs";
import { browserToolDefinition } from "./schema.mjs";

const PROFILE_INDEPENDENT_ACTIONS = new Set(["doctor", "profiles", "importprofile"]);

function readNativeErrors(output) {
  return (output?.content ?? []).flatMap((item) => {
    if (item?.type !== "text" || typeof item.text !== "string") return [];

    try {
      const value = JSON.parse(item.text);
      if (value?.type !== "tool_error" && !value?.error) return [];
      return [{
        type: value.type ?? null,
        message: value.message ?? null,
        error: value.error ?? null,
      }];
    } catch {
      return [];
    }
  });
}

export async function handleBrowserTool(name, args = {}) {
  if (name !== browserToolDefinition.name) return undefined;

  const nativeArgs = args.profile || PROFILE_INDEPENDENT_ACTIONS.has(args.action)
    ? args
    : { ...args, profile: "chrome" };
  const startedAt = Date.now();
  const result = await invokeGatewayTool("browser", nativeArgs);
  const response = normalizeToolOutput(result);

  if (!result?.ok) {
    return {
      ...response,
      diagnostics: {
        stage: result?.error?.type ?? "gateway_tool_error",
        action: args.action ?? null,
        kind: args.kind ?? null,
        elapsedMs: result?.error?.elapsedMs ?? null,
      },
    };
  }

  const nativeErrors = readNativeErrors(result.output);
  if (nativeErrors.length === 0) {
    return { ...response, diagnostics: result.diagnostics ?? null };
  }

  const diagnostics = {
    stage: "native_browser_tool_execution",
    action: args.action ?? null,
    kind: args.kind ?? null,
    elapsedMs: result.diagnostics?.elapsedMs ?? null,
    nativeErrors,
    gatewayLogContext: await getRecentGatewayToolErrorLog(startedAt),
  };

  return {
    isError: true,
    diagnostics,
    content: [{
      type: "text",
      text: JSON.stringify({ type: "native_browser_tool_execution_error", ...diagnostics }, null, 2),
    }],
  };
}