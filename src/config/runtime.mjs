import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

export const root = process.env.OPENCLAW_HOME || join(process.env.LOCALAPPDATA || process.cwd(), "OpenClawBeta");
const appRoot = process.env.OPENCLAW_APP_ROOT || join(root, "app", "node_modules");
export const stateDir = process.env.OPENCLAW_STATE_DIR || join(root, "state");
const bundledNode = join(root, "runtime", "node.exe");
export const runtimeNode = process.env.OPENCLAW_NODE_PATH || (existsSync(bundledNode) ? bundledNode : process.execPath);
export const openclawCli = process.env.OPENCLAW_CLI_PATH || join(appRoot, "openclaw", "openclaw.mjs");
export const host = process.env.OPENCLAW_BRIDGE_HOST || "127.0.0.1";
export const port = Number(process.env.OPENCLAW_BRIDGE_PORT || 19003);
export const agentId = process.env.OPENCLAW_BRIDGE_AGENT || "main";
export const gatewayPort = Number(process.env.OPENCLAW_GATEWAY_PORT || 19001);
export const invokeTimeoutMs = Number(process.env.OPENCLAW_BRIDGE_INVOKE_TIMEOUT_MS || 120000);
export const computerNode = process.env.OPENCLAW_COMPUTER_NODE || "OpenClaw Windows CUA";

process.env.OPENCLAW_STATE_DIR = stateDir;
process.env.OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || join(stateDir, "openclaw.json");
process.env.OPENCLAW_WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || join(stateDir, "workspace");
process.env.OPENCLAW_GATEWAY_PORT = String(gatewayPort);

if (!existsSync(runtimeNode)) throw new Error("Node.js executable not found: " + runtimeNode);
if (!existsSync(openclawCli)) throw new Error("OpenClaw CLI entry point not found: " + openclawCli + ". Set OPENCLAW_CLI_PATH in local configuration.");
if (!existsSync(process.env.OPENCLAW_CONFIG_PATH)) throw new Error("OpenClaw config not found: " + process.env.OPENCLAW_CONFIG_PATH + ". Set OPENCLAW_CONFIG_PATH in local configuration.");

const gatewayConfig = JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
export const gatewayToken = gatewayConfig.gateway?.auth?.token || process.env.OPENCLAW_GATEWAY_TOKEN;
if (!gatewayToken) throw new Error("OpenClaw Gateway token is missing from the beta config.");
