export const monitorEvents = [];
export const eventClients = new Set();
let nextEventId = 1;
let firstRetainedEventId = 1;

function redact(value, key = "") {
  if (/secret|token|password|api.?key|authorization|cookie|credential/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  if (typeof value === "string") return value.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]").replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 16000);
  return value;
}

function eventCommand(args) {
  return args?.command ?? args?.cmd ?? args?.script ?? args?.method ?? "";
}

function publishEvent(event) {
  if (event.id < firstRetainedEventId) return;
  const safe = redact(event);
  const index = monitorEvents.findIndex(item => item.id === safe.id);
  if (index < 0) monitorEvents.push(safe); else monitorEvents[index] = safe;
  if (monitorEvents.length > 200) monitorEvents.splice(0, monitorEvents.length - 200);
  const message = "data: " + JSON.stringify(safe) + "\n\n";
  for (const client of eventClients) { try { client.write(message); } catch { eventClients.delete(client); } }
}

export function clearMonitorEvents() {
  const clearedCount = monitorEvents.length;
  monitorEvents.length = 0;
  firstRetainedEventId = nextEventId;
  const message = "data: " + JSON.stringify({ type: "clear" }) + "\n\n";
  for (const client of eventClients) { try { client.write(message); } catch { eventClients.delete(client); } }
  return clearedCount;
}

export function beginToolEvent(tool, args, requestId) {
  const event = { id: nextEventId++, requestId: String(requestId ?? ""), tool, arguments: redact(args), command: redact(eventCommand(args)), method: args?.method, status: "running", startedAt: new Date().toISOString(), finishedAt: null, durationMs: null, output: null, error: null };
  publishEvent(event); return event;
}

function parseContentForMonitor(item) {
  if (item?.type === "image") return { type: "image", mimeType: item.mimeType || "unknown", note: "Image payload omitted from monitor log." };
  if (item?.type === "text" && typeof item.text === "string") {
    try { return redact(JSON.parse(item.text)); } catch { return redact(item.text); }
  }
  return redact(item);
}

function compactDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return diagnostics;
  const compact = { ...diagnostics };
  // The primary error payload keeps these fields; repeating them under diagnostics bloats the copied log.
  for (const key of ["originalError", "nativeErrors", "gatewayLogContext", "gatewayLog", "gatewayLogLookup"]) delete compact[key];
  return Object.keys(compact).length ? redact(compact) : null;
}

export function finishToolEvent(event, result, error) {
  const finishedAt = new Date().toISOString();
  event.finishedAt = finishedAt;
  event.durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(event.startedAt));
  event.status = error || result?.isError ? "error" : "success";

  if (result?.diagnostics) {
    const diagnostics = compactDiagnostics(result.diagnostics);
    if (diagnostics) event.diagnostics = diagnostics;
  }

  if (error) {
    const detail = error instanceof Error
      ? { name: error.name, message: error.message, code: error.code ?? null, cause: error.cause ? String(error.cause) : null, stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 8).join("\n") : null }
      : { message: String(error) };
    event.error = redact(detail);
  }

  if (result) {
    const content = result.content || result.result?.content;
    if (Array.isArray(content)) {
      const parsedContent = content.map(parseContentForMonitor);
      if (result.isError) {
        // Keep the full failure response once under Error instead of repeating it in Output.
        if (!event.error) {
          const primary = parsedContent.find(item => item && typeof item === "object") ?? parsedContent[0];
          event.error = primary ? redact(primary) : { message: "Tool returned isError=true without error details." };
        }
        event.output = null;
      } else {
        event.output = parsedContent;
      }
    } else if (result.isError) {
      if (!event.error) event.error = redact(result);
      event.output = null;
    } else {
      event.output = redact(result);
    }
  }
  publishEvent(event);
}
