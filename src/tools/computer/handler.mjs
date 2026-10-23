import { randomUUID } from "node:crypto";
import { computerNode } from "../../config/runtime.mjs";
import { invokeNodeCommand } from "../../openclaw-client.mjs";
import { computerToolDefinition } from "./schema.mjs";

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function toolError(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function enqueue(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  queues.set(key, current.then(() => undefined, () => undefined));
  return current;
}

export function createComputerToolHandler({ idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
  // OpenClaw's provider permits one active execution per computer. Keep a single
  // correlated execution per node, and serialize calls so snapshots and actions
  // cannot race one another.
  const sessions = new Map();
  const queues = new Map();

  function clearSessionTimer(session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = undefined;
  }

  function scheduleIdleCleanup(session) {
    clearSessionTimer(session);
    if (!(idleTimeoutMs > 0)) return;

    session.timer = setTimeout(() => {
      void enqueue(queues, session.key, async () => {
        if (sessions.get(session.key) !== session) return;

        const idleFor = Date.now() - session.lastUsedAt;
        if (idleFor < idleTimeoutMs) {
          scheduleIdleCleanup(session);
          return;
        }

        let result;
        try {
          result = await session.invoke(session.node, "computer.act", {
            action: "__close_execution",
            executionId: session.executionId,
            reason: "bridge-idle-timeout",
          }, 10000, { executionId: session.executionId });
        } catch {
          result = toolError("Could not close the idle computer execution.");
        }

        if (sessions.get(session.key) !== session) return;
        if (result?.isError) {
          session.lastUsedAt = Date.now();
          scheduleIdleCleanup(session);
          return;
        }

        clearSessionTimer(session);
        sessions.delete(session.key);
      }).catch(() => {
        if (sessions.get(session.key) === session) {
          session.lastUsedAt = Date.now();
          scheduleIdleCleanup(session);
        }
      });
    }, idleTimeoutMs);
    session.timer.unref?.();
  }

  async function closeSession(session, reason, timeoutMs = 15000) {
    clearSessionTimer(session);
    const result = await session.invoke(session.node, "computer.act", {
      action: "__close_execution",
      executionId: session.executionId,
      reason,
    }, Math.min(timeoutMs, 15000), { executionId: session.executionId });

    if (!result?.isError) {
      if (sessions.get(session.key) === session) sessions.delete(session.key);
    } else {
      session.lastUsedAt = Date.now();
      scheduleIdleCleanup(session);
    }
    return result;
  }

  return async function handleComputerTool(name, args = {}, dependencies = {}) {
    if (name !== computerToolDefinition.name) return undefined;

    const invoke = dependencies.invokeNodeCommand ?? invokeNodeCommand;
    const node = String(dependencies.node ?? computerNode);
    const key = node;
    const timeoutMs = Number.isInteger(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : 30000;

    if (args.action !== "snapshot" && args.action !== "close_execution" && !ACTION_FIELDS[args.action]) {
      return toolError("Unsupported desktop action: " + String(args.action));
    }

    if (args.executionId !== undefined && !UUID_PATTERN.test(args.executionId)) {
      return toolError("executionId must be the UUID returned by action=snapshot.");
    }

    return enqueue(queues, key, async () => {
      let session = sessions.get(key);

      if (args.action === "close_execution") {
        if (!session && !args.executionId) {
          return { content: [{ type: "text", text: "No active computer execution to close." }] };
        }
        if (session && args.executionId && args.executionId !== session.executionId) {
          return toolError("executionId does not match the active computer execution.");
        }
        if (!session) {
          session = { key, node, invoke, executionId: args.executionId, lastUsedAt: Date.now() };
        }
        return closeSession(session, "bridge-client-close", timeoutMs);
      }

      const requestedId = args.executionId;
      if (session && requestedId && requestedId !== session.executionId) {
        const closed = await closeSession(session, "bridge-execution-replaced", timeoutMs);
        if (closed?.isError) return closed;
        session = undefined;
      }

      const executionId = requestedId ?? session?.executionId ?? randomUUID();
      if (!session || session.executionId !== executionId) {
        session = { key, node, invoke, executionId, lastUsedAt: Date.now(), timer: undefined };
        sessions.set(key, session);
      } else {
        session.node = node;
        session.invoke = invoke;
      }
      session.lastUsedAt = Date.now();
      scheduleIdleCleanup(session);

      let result;
      if (args.action === "snapshot") {
        const params = { ...pick(args, ["screenIndex", "maxWidth", "quality", "format"]), executionId };
        result = await invoke(node, "screen.snapshot", params, timeoutMs, { executionId });
      } else {
        const params = { action: args.action, ...pick(args, ACTION_FIELDS[args.action]), executionId };
        result = await invoke(node, "computer.act", params, timeoutMs, {
          executionId,
          refWidth: args.refWidth,
        });
      }

      // Keep the execution alive across separate MCP calls so later actions can
      // use the same snapshot/observation references. The idle timer is a safety
      // net for clients that never send close_execution.
      if (sessions.get(key) === session) {
        session.lastUsedAt = Date.now();
        scheduleIdleCleanup(session);
      }
      return result;
    });
  };
}

export const handleComputerTool = createComputerToolHandler();
