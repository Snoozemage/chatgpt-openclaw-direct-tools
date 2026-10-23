import { invokeGatewayTool, getRecentGatewayToolErrorLog } from "../../openclaw-client.mjs";
import { normalizeToolOutput } from "../../mcp/format.mjs";
import { browserToolDefinition } from "./schema.mjs";
import {
  isBrowserTimeout,
  outputContainsTargetUrl,
  OPEN_RECOVERY_PROBE_TIMEOUT_MS,
  prepareBrowserArgs,
} from "./recovery.mjs";

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

async function reconcileTimedOutOpen(args, nativeArgs, originalResult) {
  const targetUrl = args.targetUrl ?? args.url;
  if (typeof targetUrl !== "string" || !targetUrl.trim()) return null;

  let tabsResult;
  try {
    tabsResult = await invokeGatewayTool("browser", {
      action: "tabs",
      profile: nativeArgs.profile || "user",
      timeoutMs: OPEN_RECOVERY_PROBE_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  if (!tabsResult?.ok || !outputContainsTargetUrl(tabsResult.output, targetUrl)) return null;

  const elapsedMs = originalResult?.error?.elapsedMs
    ?? originalResult?.diagnostics?.elapsedMs
    ?? null;
  const details = {
    action: "open",
    outcome: "target_url_observed_in_tabs",
    targetUrl,
    message: "OpenClaw reported a timeout, but the requested URL is present in the current tab list. The bridge did not retry open.",
  };

  return {
    diagnostics: {
      stage: "open_timeout_reconciled",
      action: "open",
      elapsedMs,
      verification: "tabs",
      targetUrlObserved: true,
    },
    content: [{
      type: "text",
      text: JSON.stringify(details, null, 2),
    }],
  };
}

export async function handleBrowserTool(name, args = {}) {
  if (name !== browserToolDefinition.name) return undefined;

  const nativeArgs = prepareBrowserArgs(args);
  const startedAt = Date.now();
  const result = await invokeGatewayTool("browser", nativeArgs);
  const nativeErrors = result?.ok ? readNativeErrors(result.output) : [];
  const failed = !result?.ok || nativeErrors.length > 0;

  if (args.action === "open" && failed && isBrowserTimeout(result)) {
    const recovered = await reconcileTimedOutOpen(args, nativeArgs, result);
    if (recovered) return recovered;
  }

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