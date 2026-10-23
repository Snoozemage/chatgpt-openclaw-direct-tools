export const BROWSER_ACTIONS = Object.freeze([
  "doctor", "status", "start", "stop", "profiles", "importprofile",
  "tabs", "open", "focus", "close", "snapshot", "screenshot",
  "navigate", "console", "requests", "errors", "text", "emulate",
  "pdf", "download", "waitfordownload", "upload", "dialog", "act",
]);

export const BROWSER_ACT_KINDS = Object.freeze([
  "batch", "click", "clickCoords", "type", "press", "hover",
  "scrollIntoView", "drag", "select", "fill", "resize", "wait",
  "evaluate", "close",
]);

const string = (description) => ({ type: "string", description });
const integer = (description) => ({ type: "integer", description });
const boolean = (description) => ({ type: "boolean", description });
const stringArray = (description) => ({
  type: "array",
  items: { type: "string" },
  description,
});

const actProperties = {
  targetId: string("Browser target ID returned by tabs or snapshot."),
  tabId: string("Tab ID returned by tabs or snapshot."),
  ref: string("Element ref returned by the latest snapshot."),
  selector: string("CSS selector for selector-based actions."),
  text: string("Text to type, or a text condition for wait."),
  key: string("Key for kind=press, such as Enter, Escape, Tab or Control+Shift+T."),
  submit: boolean("Submit after typing where supported."),
  slowly: boolean("Type slowly where supported."),
  doubleClick: boolean("Double-click where supported."),
  button: string("Mouse button, such as left, right or middle."),
  modifiers: stringArray("Modifier keys supported by the selected action."),
  x: { type: "number", description: "Horizontal coordinate for clickCoords." },
  y: { type: "number", description: "Vertical coordinate for clickCoords." },
  startRef: string("Starting element ref for drag."),
  startSelector: string("Starting CSS selector for drag."),
  endRef: string("Destination element ref for drag."),
  endSelector: string("Destination CSS selector for drag."),
  values: stringArray("Values to select."),
  fields: {
    type: "array",
    description: "For kind=fill, pass an array of objects with ref and value.",
    items: {
      type: "object",
      properties: {
        ref: string("Element ref from the latest snapshot."),
        type: string("Native form input type, where needed."),
        value: {
          type: ["string", "number", "boolean", "null"],
          description: "Value to set in the field.",
        },
      },
      additionalProperties: true,
    },
  },
  stopOnError: boolean("Stop a batch after the first failed step."),
  delayMs: integer("Delay between batch steps in milliseconds."),
  width: integer("Viewport width for resize."),
  height: integer("Viewport height for resize."),
  timeMs: integer("Wait duration in milliseconds."),
  url: string("URL condition for kind=wait. For open/navigate, use targetUrl."),
  loadState: string("Page load state supported by OpenClaw."),
  textGone: string("Wait until this text disappears."),
  fn: string("Expression for evaluate or a supported wait condition."),
  timeoutMs: integer("Timeout in milliseconds, where supported by the native action."),
};

const properties = {
  action: { type: "string", enum: BROWSER_ACTIONS, description: "Browser action to execute." },
  target: string("Native execution target, where supported."),
  dashboard: string("Browser dashboard selector, where supported."),
  node: string("Paired browser-node selector, where supported."),
  into: string("Destination profile for importprofile."),
  domains: stringArray("Domain filters for importprofile."),
  targetUrl: string("Destination URL for open or navigate."),
  label: string("Optional browser tab label."),
  limit: integer("Maximum number of returned tabs, errors, requests or results."),
  maxChars: integer("Maximum snapshot or text output size."),
  mode: string("Snapshot mode supported by OpenClaw."),
  snapshotFormat: string("Snapshot representation, such as ai or aria."),
  refs: string("Element reference strategy, such as role or aria."),
  interactive: boolean("Include interactive elements in snapshots where supported."),
  compact: boolean("Request compact snapshot output."),
  depth: integer("Maximum snapshot depth."),
  frame: string("Optional frame selector."),
  labels: boolean("Label screenshot or snapshot elements where supported."),
  fullPage: boolean("Capture a full-page screenshot."),
  element: string("Element ref or selector for screenshot or file-input actions."),
  type: string("Screenshot format or a native field type where applicable."),
  path: string("Output path for screenshot, PDF or download actions."),
  urls: boolean("Include URLs in results where supported."),
  level: string("Console or error level filter."),
  filter: string("Substring filter for captured network requests."),
  clear: boolean("Clear collected records after reading where supported."),
  query: string("Snapshot filter."),
  device: string("Device profile for emulate."),
  colorScheme: string("Color scheme for emulate."),
  timezoneId: string("Timezone identifier for emulate."),
  locale: string("Locale for emulate."),
  paths: stringArray("File paths for upload."),
  inputRef: string("File input ref for upload."),
  dialogId: string("Target dialog ID."),
  accept: boolean("Accept or dismiss a dialog."),
  promptText: string("Text for a prompt dialog."),
  kind: { type: "string", enum: BROWSER_ACT_KINDS, description: "Operation to perform for action=act." },
  ...actProperties,
  timeoutMs: integer("Timeout in milliseconds, where supported by the native action."),
  actions: {
    type: "array",
    description: "Ordered steps for kind=batch.",
    items: {
      type: "object",
      properties: {
        kind: { type: "string", enum: BROWSER_ACT_KINDS },
        ...actProperties,
      },
      additionalProperties: true,
    },
  },
};

export const browserToolDefinition = {
  name: "openclaw_browser",
  description: "Control Chrome through OpenClaw. Use action=open or navigate with targetUrl; if Chrome is not running, use open to launch it and open the requested URL. Use snapshot before page interactions, then pass its refs to action=act.",
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties,
    required: ["action"],
    additionalProperties: true,
  },
};
