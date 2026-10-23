import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildSchemaExport } from "./lib/schema-export.mjs";

const runtime = await import("../../../src/config/runtime.mjs");
const { gatewayCall } = await import("../../../src/openclaw-client.mjs");

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${name}.`);
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function findToolFactoryModule(packageRoot) {
  const distPath = path.join(packageRoot, "dist");
  const entries = await readdir(distPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^agent-tools-.*\.mjs$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const name of candidates) {
    const fullPath = path.join(distPath, name);
    const source = await readFile(fullPath, "utf8");
    if (!source.includes("function createOpenClawCodingToolsAsync")
      || !source.includes("assembleOpenClawCodingTools(options")) continue;

    const imported = await import(pathToFileURL(fullPath).href);
    const factory = imported.createOpenClawCodingToolsAsync ?? imported.n;
    if (typeof factory === "function") return { factory, moduleName: name };
  }

  throw new Error(
    "Could not locate OpenClaw's internal tool factory in dist/agent-tools-*.mjs. "
    + "The installed OpenClaw build may have changed; refusing to export guessed schemas."
  );
}

async function main() {
  const agentId = readOption("--agent-id", runtime.agentId);
  const sessionKey = readOption("--session-key", `agent:${agentId}:tool-schema-export`);
  const workspaceDir = readOption("--workspace", path.join(runtime.stateDir, "workspace"));
  const outputPath = path.resolve(readOption("--output", "artifacts/openclaw-tool-schemas.json"));
  const includeCatalog = !hasFlag("--no-catalog");

  const packageRoot = path.dirname(runtime.openclawCli);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const { factory, moduleName } = await findToolFactoryModule(packageRoot);

  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const tools = await factory({
    config,
    agentId,
    workspaceDir,
    sessionKey,
  });

  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error("The installed OpenClaw factory returned no runtime tools; output was not written.");
  }

  let catalog = null;
  let catalogError = null;
  if (includeCatalog) {
    try {
      catalog = await gatewayCall("tools.catalog", { agentId }, 20000);
    } catch (error) {
      catalogError = error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800);
      process.stderr.write("Warning: could not load Gateway catalog; exporting runtime schemas only.\n");
    }
  }

  const bundle = buildSchemaExport({
    tools,
    catalog,
    openclawVersion: packageJson.version ?? "unknown",
    agentId,
    factoryModule: moduleName,
    catalogError,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(bundle, null, 2) + "\n", { encoding: "utf8", flag: "w" });

  process.stdout.write([
    `OpenClaw version: ${bundle.runtime.openclawVersion}`,
    `Agent: ${agentId}`,
    `Full runtime schemas: ${bundle.summary.fullSchemaCount}`,
    `Catalog summaries: ${bundle.summary.catalogEntryCount}`,
    `Catalog entries without a full schema in this runtime context: ${bundle.summary.catalogEntriesWithoutFullSchema}`,
    `Output: ${outputPath}`,
  ].join("\n") + "\n");

  if (catalogError) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
