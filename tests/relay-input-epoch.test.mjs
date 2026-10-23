import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const openclawHome = process.env.OPENCLAW_HOME
  ?? join(process.env.LOCALAPPDATA ?? "", "OpenClawBeta");
const handlerPath = join(
  openclawHome,
  "app",
  "node_modules",
  "openclaw",
  "dist",
  "extensions",
  "browser",
  "chrome-extension",
  "modules",
  "relay-command-handler.js",
);

let createRelayCommandHandler;
if (existsSync(handlerPath)) {
  ({ createRelayCommandHandler } = await import(pathToFileURL(handlerPath).href));
}

function makeHarness({ onDispatch = async () => ({ accepted: true }) } = {}) {
  const baseEpoch = { id: "base" };
  const renewedEpoch = { id: "renewed" };
  let activeEpoch = baseEpoch;
  let revoked = false;
  let attached = true;
  const commands = [];
  const replies = [];
  const checks = [];

  globalThis.chrome = {
    debugger: {
      sendCommand: async (_target, method, params) => {
        commands.push({ method, params });
        return onDispatch({
          method,
          params,
          setEpoch: (epoch) => { activeEpoch = epoch; },
          setRevoked: (value) => { revoked = value; },
        });
      },
    },
  };

  const requireAccessibleTab = async (tabId, epoch) => {
    checks.push(epoch);
    if (!attached || revoked || epoch !== activeEpoch) {
      throw new Error(`tab ${tabId} access was revoked`);
    }
    return { id: tabId, url: "https://example.test/" };
  };

  const handler = createRelayCommandHandler({
    send: (reply) => replies.push(reply),
    isCurrent: () => true,
    attachDebugger: async () => ({ targetId: "target" }),
    detachDebugger: async () => {},
    createTab: async () => {},
    focusWindowForTab: async () => {},
    scheduleTabsSync: () => {},
    captureDebugger: () => () => {
      if (!attached) throw new Error("Debugger attachment retired");
    },
    captureAccess: () => activeEpoch,
    currentAccessEpoch: () => activeEpoch,
    requireAccessibleTab,
    requireNavigatedTab: requireAccessibleTab,
    navigateTab: async () => ({ frameId: "frame" }),
  });

  return {
    handler,
    baseEpoch,
    renewedEpoch,
    commands,
    replies,
    checks,
    setEpoch: (epoch) => { activeEpoch = epoch; },
    revoke: () => { revoked = true; },
    detach: () => { attached = false; },
  };
}

const runCdp = (handler, seq, method, params = {}) => handler({
  type: "cdp",
  seq,
  tabId: 41,
  method,
  params,
});

const runKey = (handler, seq, type) => runCdp(
  handler,
  seq,
  "Input.dispatchKeyEvent",
  { type, key: "Enter" },
);

if (!createRelayCommandHandler) {
  test("OpenClaw relay-handler regression tests", { skip: "Installed OpenClaw package not found" }, () => {});
} else {
  test("queued key-up uses the attachment epoch renewed after key-down navigation", async () => {
    let startedResolve;
    let nativeResolve;
    const started = new Promise((resolve) => { startedResolve = resolve; });
    const nativeCommand = new Promise((resolve) => { nativeResolve = resolve; });
    const harness = makeHarness({
      onDispatch: ({ params }) => {
        if (params.type === "keyDown") {
          startedResolve();
          return nativeCommand;
        }
        return { accepted: true };
      },
    });

    const keyDown = runKey(harness.handler, 1, "keyDown");
    await started;
    const keyUp = runKey(harness.handler, 2, "keyUp");

    // Simulate the access-policy owner renewing the same attachment after an
    // eligible URL update, before the native key-down command finishes.
    harness.setEpoch(harness.renewedEpoch);
    nativeResolve({ accepted: true });
    await Promise.all([keyDown, keyUp]);

    assert.deepEqual(harness.commands.map((entry) => entry.params.type), ["keyDown", "keyUp"]);
    assert.deepEqual(harness.replies.map((reply) => reply.type), ["result", "result"]);
    assert.equal(harness.replies.some((reply) => /access was revoked/.test(reply.message ?? "")), false);
  });

  test("a real access revocation still rejects input and never replays it", async () => {
    const harness = makeHarness({
      onDispatch: ({ setRevoked }) => {
        setRevoked(true);
        return { accepted: true };
      },
    });

    await runKey(harness.handler, 1, "keyDown");

    assert.equal(harness.commands.length, 1);
    assert.equal(harness.replies.length, 1);
    assert.equal(harness.replies[0].type, "error");
    assert.match(harness.replies[0].message, /access was revoked/);
  });

  test("a completed Page.navigate can return on the access owner's renewed epoch", async () => {
    const harness = makeHarness({
      onDispatch: ({ setEpoch }) => {
        setEpoch({ id: "renewed-by-policy" });
        return { frameId: "frame-1", loaderId: "loader-1" };
      },
    });

    await runCdp(harness.handler, 4, "Page.navigate", {
      url: "https://example.test/destination",
    });

    assert.equal(harness.commands.length, 1, "navigation must never be replayed");
    assert.deepEqual(harness.replies, [{
      type: "result",
      seq: 4,
      result: { frameId: "frame-1", loaderId: "loader-1" },
    }]);
    assert.equal(harness.checks.at(-1).id, "renewed-by-policy");
  });

  test("a Page.navigate result stays blocked when access is actually revoked", async () => {
    const harness = makeHarness({
      onDispatch: ({ setEpoch, setRevoked }) => {
        setEpoch({ id: "renewed-but-revoked" });
        setRevoked(true);
        return { frameId: "frame-1", loaderId: "loader-1" };
      },
    });

    await runCdp(harness.handler, 5, "Page.navigate", {
      url: "https://example.test/destination",
    });

    assert.equal(harness.commands.length, 1, "a completed navigation must never be replayed");
    assert.equal(harness.replies.length, 1);
    assert.equal(harness.replies[0].type, "error");
    assert.match(harness.replies[0].message, /access was revoked/);
  });

  test("an attachment replacement still blocks input results", async () => {
    const harness = makeHarness({
      onDispatch: ({ setEpoch }) => {
        // A changed attachment cannot obtain a trusted refreshed epoch.
        setEpoch({ id: "new-but-not-policy-renewed" });
        harness.detach();
        return { accepted: true };
      },
    });

    await runKey(harness.handler, 1, "keyDown");

    assert.equal(harness.replies.length, 1);
    assert.equal(harness.replies[0].type, "error");
    assert.match(harness.replies[0].message, /Debugger attachment retired/);
  });
}
