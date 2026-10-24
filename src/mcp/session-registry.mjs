const sessionsByKey = new Map();
const hiddenSessionKeys = new Set();
let nextSessionNumber = 1;
const ACTIVE_WINDOW_MS = 30_000;
const MAX_SESSION_KEY_LENGTH = 512;

export function requestSessionId(req) {
  const headers = req?.headers ?? req ?? {};
  for (const name of ["x-openai-session", "mcp-session-id", "x-openai-conversation-id", "x-openai-session-id"]) {
    const value = typeof headers.get === "function" ? headers.get(name) : headers[name];
    const normalized = Array.isArray(value) ? value[0] : value;
    if (typeof normalized !== "string") continue;
    const candidate = normalized.trim();
    if (candidate && candidate.length <= MAX_SESSION_KEY_LENGTH) return candidate;
  }
  return undefined;
}

function getOrCreate(sessionKey) {
  if (!sessionKey) return undefined;
  let session = sessionsByKey.get(sessionKey);
  if (!session) {
    const number = nextSessionNumber++;
    const now = Date.now();
    session = { key: sessionKey, id: `agent-${number}`, task: "ChatGPT conversation", firstSeenAt: now, lastSeenAt: now, lastTool: null, initialized: false, initializedAt: null };
    sessionsByKey.set(sessionKey, session);
  }
  return session;
}

function snapshot(session) {
  if (!session) return undefined;
  const now = Date.now();
  return { id: session.id, task: session.task, firstSeenAt: session.firstSeenAt, lastSeenAt: session.lastSeenAt, lastTool: session.lastTool, initialized: session.initialized, initializedAt: session.initializedAt, status: now - session.lastSeenAt < ACTIVE_WINDOW_MS ? "active" : "inactive" };
}

export function touchSession(sessionKey) {
  const session = getOrCreate(sessionKey);
  if (!session) return undefined;
  session.lastSeenAt = Date.now();
  return hiddenSessionKeys.has(sessionKey) ? undefined : snapshot(session);
}

export function markSessionTool(sessionKey, toolName) {
  const session = getOrCreate(sessionKey);
  if (!session) return undefined;
  hiddenSessionKeys.delete(sessionKey);
  session.lastSeenAt = Date.now();
  session.lastTool = toolName;
  return snapshot(session);
}

export function setSessionTask(sessionKey, task) {
  const session = getOrCreate(sessionKey);
  if (!session) return undefined;
  if (typeof task === "string" && task.trim()) session.task = task.trim().slice(0, 160);
  session.lastSeenAt = Date.now();
  return snapshot(session);
}

export function markSessionInitialized(sessionKey) {
  const session = getOrCreate(sessionKey);
  if (!session) return undefined;
  session.initialized = true;
  session.initializedAt ??= Date.now();
  session.lastSeenAt = Date.now();
  return snapshot(session);
}

export function getSessionSnapshot(sessionKey) {
  return snapshot(sessionKey ? sessionsByKey.get(sessionKey) : undefined);
}

export function isSessionInitialized(sessionKey) {
  return Boolean(sessionKey && sessionsByKey.get(sessionKey)?.initialized);
}

export function removeSessionFromMonitor(sessionId) {
  const entry = [...sessionsByKey.entries()].find(([, session]) => session.id === sessionId);
  if (!entry) return false;
  hiddenSessionKeys.add(entry[0]);
  return true;
}

export function listSessions() {
  return [...sessionsByKey.entries()]
    .filter(([sessionKey]) => !hiddenSessionKeys.has(sessionKey))
    .map(([, session]) => snapshot(session))
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}
