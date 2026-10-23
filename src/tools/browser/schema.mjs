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
  key: string("Key for kind=press. OpenClaw examples include Enter, Escape, Tab and Control+Shift+T; aliases include Return, Esc, Del, Ctrl and Cmd."),
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
    description: "Fields for kind=fill; each entry identifies an element and value.",
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
  action: {
    type: "string",
    enum: BROWSER_ACTIONS,
    description: "Native OpenClaw Browser action to execute.",
  },
  target: string("Native execution target, where supported."),
  dashboard: string("Browser dashboard selector, where supported."),
  node: string("Paired browser-node selector, where supported."),
  profile: string("Browser profile. The bridge defaults to chrome for actions that use a profile."),
  browser: string("Browser engine or profile selector, where supported."),
  systemProfile: string("Operating-system browser profile selector."),
  into: string("Destination profile for importprofile."),
  domains: stringArray("Domain filters for importprofile."),
  targetUrl: string("Destination for open or navigate. Pass the URL unchanged; supported schemes and behavior are determined by OpenClaw and the browser."),
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
  kind: { type: "string", enum: BROWSER_ACT_KINDS, description: "BrowserAct operation for action=act." },
  ...actProperties,
  timeoutMs: integer("Timeout in milliseconds, where supported by the native action. For action=open, defaults to 10000 unless explicitly provided."),
  actions: {
    type: "array",
    description: "Ordered BrowserAct steps for kind=batch.",
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
  description: [
    "Forwards the requested Browser action and arguments to the installed OpenClaw Browser tool through Gateway /tools/invoke.",
    "The bridge does not duplicate Browser payload validation or rewrite supplied values. It supplies profile=chrome when omitted for profile-dependent actions and defaults action=open to a 10-second timeout unless timeoutMs is explicitly provided. OpenClaw remains authoritative for supported parameters, URL schemes, keyboard input, profiles and action behavior; native errors are returned for troubleshooting.",
    "Use snapshot before interacting with page elements, then use refs from that snapshot. Use targetUrl for open/navigate and kind plus the relevant fields for action=act.",
    "Common act fields: click/hover/scrollIntoView/select use ref or selector; type uses ref or selector plus text; press uses key; clickCoords uses x and y; drag uses startRef/startSelector and endRef/endSelector; fill uses fields with a ref and value; resize uses width and height; wait uses a supported condition; evaluate uses fn; batch uses actions.",
    "Examples: { action: 'act', kind: 'press', key: 'Enter' }; { action: 'act', kind: 'fill', fields: [{ ref: 'e1', value: 'example' }] }.",
    "The bridge defaults to profile=chrome for profile-dependent actions. Select profile=openclaw only when the isolated browser is intended.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties,
    required: ["action"],
    additionalProperties: true,
  },
};