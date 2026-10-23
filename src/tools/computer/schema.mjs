export const COMPUTER_ACTIONS = Object.freeze([
  "snapshot",
  "left_click", "right_click", "middle_click", "double_click", "triple_click", "mouse_move",
  "left_click_drag", "left_mouse_down", "left_mouse_up", "scroll", "type", "key", "hold_key",
  "list_apps", "list_windows", "get_accessibility_tree", "get_cursor_position", "get_window_state",
  "launch_app", "kill_app", "bring_to_front", "set_value", "invoke_menu", "zoom",
]);

const string = (description) => ({ type: "string", description });
const integer = (description) => ({ type: "integer", description });
const number = (description) => ({ type: "number", description });
const boolean = (description) => ({ type: "boolean", description });

const properties = {
  action: {
    type: "string",
    enum: COMPUTER_ACTIONS,
    description: "Desktop action to perform. Use snapshot first to inspect the current screen.",
  },
  screenIndex: integer("Screen index for snapshot or coordinate-based input."),
  maxWidth: integer("Maximum screenshot width for action=snapshot."),
  quality: number("Screenshot quality for action=snapshot, from 0 to 1."),
  format: { type: "string", enum: ["jpeg", "png"], description: "Screenshot image format." },
  x: number("Horizontal screen coordinate."),
  y: number("Vertical screen coordinate."),
  fromX: number("Starting horizontal coordinate for action=left_click_drag."),
  fromY: number("Starting vertical coordinate for action=left_click_drag."),
  x1: number("First horizontal coordinate for action=zoom."),
  y1: number("First vertical coordinate for action=zoom."),
  x2: number("Second horizontal coordinate for action=zoom."),
  y2: number("Second vertical coordinate for action=zoom."),
  refWidth: integer("Width of the screenshot used to choose coordinates, when known."),
  windowRef: string("Window reference returned by list_windows or an accessibility query."),
  elementRef: string("Element reference returned by get_accessibility_tree or get_window_state."),
  observationId: string("Observation ID returned with the latest accessibility/window observation, when required."),
  displayFrameId: string("Display frame ID returned by a screenshot, when required by the native driver."),
  modifiers: string("Modifier keys, as accepted by the native driver."),
  deliveryMode: { type: "string", enum: ["background", "foreground"], description: "Whether to deliver input in the background or foreground." },
  durationMs: integer("Duration in milliseconds for drag or hold_key."),
  scrollDirection: { type: "string", enum: ["up", "down", "left", "right"], description: "Direction for action=scroll." },
  scrollAmount: integer("Amount to scroll for action=scroll."),
  text: string("Text to type for action=type."),
  keys: string("Key or key combination for action=key or action=hold_key."),
  app: string("Application name or executable to launch/terminate."),
  query: string("Optional filter for accessibility/window state results."),
  depth: integer("Maximum accessibility-tree depth."),
  maxElements: integer("Maximum accessibility elements to return."),
  includeScreenshot: boolean("Include a screenshot with action=get_window_state."),
  value: string("Value to set for action=set_value."),
  path: { type: "array", items: { type: "string" }, description: "Menu path segments for action=invoke_menu." },
  timeoutMs: integer("Maximum time to wait for the native node command, in milliseconds."),
};

export const computerToolDefinition = {
  name: "openclaw_computer",
  description: "Control the Windows desktop through the OpenClaw computer node. Use action=snapshot to inspect the screen, then use mouse, keyboard, window, or accessibility actions. This controls desktop UI, not browser DOM.",
  inputSchema: {
    type: "object",
    properties,
    required: ["action"],
    additionalProperties: true,
  },
};
