export function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

export function mcpText(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : jsonText(value) }] };
}

export function normalizeToolOutput(body) {
  if (!body?.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: jsonText(body?.error || body || { error: "Unknown OpenClaw error" }) }],
    };
  }
  const output = body.output || {};
  const content = [];
  for (const item of output.content || []) {
    if (item?.type === "text" && typeof item.text === "string") {
      content.push({ type: "text", text: item.text });
    } else if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
      content.push({ type: "image", data: item.data, mimeType: item.mimeType });
    } else if (item?.type === "audio" && typeof item.data === "string" && typeof item.mimeType === "string") {
      content.push({ type: "audio", data: item.data, mimeType: item.mimeType });
    } else {
      content.push({ type: "text", text: jsonText(item) });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: jsonText(output.details ?? output) });
  return { content };
}
