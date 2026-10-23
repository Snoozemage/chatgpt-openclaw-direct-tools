import { computerNode } from "../../config/runtime.mjs";
import { invokeNodeCommand } from "../../openclaw-client.mjs";
import { computerToolDefinition } from "./schema.mjs";

const COMMON_INPUT_FIELDS = [
  "screenIndex", "refWidth", "windowRef", "elementRef", "observationId",
  "deliveryMode", "displayFrameId",
];

const ACTION_FIELDS = {
  left_click: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  right_click: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  middle_click: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  double_click: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  triple_click: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  mouse_move: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  left_click_drag: [...COMMON_INPUT_FIELDS, "x", "y", "fromX", "fromY", "durationMs"],
  left_mouse_down: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  left_mouse_up: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers"],
  scroll: [...COMMON_INPUT_FIELDS, "x", "y", "modifiers", "scrollDirection", "scrollAmount"],
  type: [...COMMON_INPUT_FIELDS, "text"],
  key: [...COMMON_INPUT_FIELDS, "keys"],
  hold_key: [...COMMON_INPUT_FIELDS, "keys", "durationMs"],
  list_apps: [],
  list_windows: [],
  get_cursor_position: [],
  get_accessibility_tree: ["windowRef", "query", "depth", "maxElements"],
  get_window_state: ["windowRef", "includeScreenshot", "query", "depth", "maxElements"],
  launch_app: ["app"],
  kill_app: ["app"],
  bring_to_front: ["windowRef"],
  set_value: ["windowRef", "elementRef", "observationId", "value", "deliveryMode"],
  invoke_menu: ["windowRef", "path", "deliveryMode"],
  zoom: ["windowRef", "observationId", "x1", "y1", "x2", "y2"],
};

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export async function handleComputerTool(name, args = {}, dependencies = {}) {
  if (name !== computerToolDefinition.name) return undefined;

  const invoke = dependencies.invokeNodeCommand ?? invokeNodeCommand;
  const node = dependencies.node ?? computerNode;
  const timeoutMs = Number.isInteger(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : 30000;

  if (args.action === "snapshot") {
    const params = pick(args, ["screenIndex", "maxWidth", "quality", "format"]);
    return invoke(node, "screen.snapshot", params, timeoutMs);
  }

  const allowedFields = ACTION_FIELDS[args.action];
  if (!allowedFields) {
    return {
      isError: true,
      content: [{ type: "text", text: "Unsupported desktop action: " + String(args.action) }],
    };
  }

  const params = { action: args.action, ...pick(args, allowedFields) };
  return invoke(node, "computer.act", params, timeoutMs, { refWidth: args.refWidth });
}
