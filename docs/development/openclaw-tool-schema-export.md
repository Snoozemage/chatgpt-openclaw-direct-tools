# OpenClaw Tool Schema Export

## Purpose

Export the exact JSON input schemas (and output schemas when declared) from the tool definitions constructed by the installed OpenClaw runtime. This is a developer/research utility for implementing and validating bridge wrappers. It is not a public MCP tool and it is not part of the bridge's runtime dispatch path.

The exporter does not call any target tool's `execute` function, and it does not use `dispatch_action` as a fallback. Runtime executors are deliberately omitted from the JSON output.

## Run

From this repository worktree in PowerShell:

```powershell
npm run export:openclaw-schemas
```

The default output is:

```text
artifacts/openclaw-tool-schemas.json
```

Use a different destination when needed:

```powershell
npm run export:openclaw-schemas -- --output .\artifacts\schemas-review.json
```

Optional parameters:

- `--agent-id main`: build the tool surface for a configured OpenClaw agent.
- `--workspace <path>`: workspace passed to the runtime tool builder.
- `--session-key <key>`: synthetic construction context; this operation only builds tool definitions and does not run a session.
- `--no-catalog`: skip the supplementary Gateway catalog lookup. Exact schemas are still exported from the runtime factory.

The script uses the bundled OpenClaw Beta paths resolved by `src/config/runtime.mjs`. Existing `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_NODE_PATH`, `OPENCLAW_CLI_PATH`, and related runtime variables remain honored where supported by that module.

## Output semantics

- `tools`: exact runtime tool definitions, with `inputSchema` copied from the constructed tool's `parameters`, and `outputSchema` copied when present.
- `catalogEntriesWithoutFullSchema`: entries returned by Gateway `tools.catalog` which are not present in the constructed runtime tool list. These have names and descriptive metadata only; parameter summaries, if provided, are clearly labeled `parameterSummary`, not represented as JSON Schema.
- `summary`: counts that distinguish full schemas from catalog-only metadata. `allCatalogEntriesHaveFullSchema` remains false when the current runtime surface does not supply schemas for every catalog entry.

This distinction is deliberate. A catalog entry is not proof that its full schema is available in the current runtime context. The exporter does not invent schemas for tools that are unavailable due to provider configuration, capability selection, authorization, or runtime-specific construction.

## Implementation and compatibility

OpenClaw Beta `2026.10.10-beta.3` does not expose a verified public Gateway RPC that returns every constructed tool's full schema. The exporter therefore discovers and invokes the installed package's internal `createOpenClawCodingToolsAsync` factory and separately queries the supported Gateway `tools.catalog` method for descriptive metadata.

The internal factory is not a stable public API and may change between OpenClaw releases. The exporter checks for expected source/export markers and fails rather than fabricating a result if the module cannot be found. Revalidate this code after updating OpenClaw Beta.

Implementation lives under `scripts/devtools/openclaw-tool-schema-export/`; it is intentionally outside `src/tools/` because it is a developer-only utility, not a model-facing MCP tool.

The exported set is the tool surface constructed for the chosen agent/workspace context. It is not a promise that every entry in the broader configurable catalog is available in every agent, model provider, channel, or execution harness.

## Validation

Run the unit tests:

```powershell
npm run test:unit
```

The tests validate schema preservation, omission of executable functions, catalog-to-runtime mapping, explicit reporting of missing full schemas, and empty/duplicate inventory rejection.
