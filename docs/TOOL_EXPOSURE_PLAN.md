# Tool Exposure Plan

## Current state

The bridge exposes one public MCP tool: `openclaw_browser`. Its schema and request handler are grouped in `src/tools/browser/`; payload validation remains the native OpenClaw Browser runtime responsibility. The tool definition list in `src/mcp/tool-definitions.mjs` and handler list in `src/mcp/tool-dispatcher.mjs` both register this tool.

## Implementation rule

Implement tools incrementally, one tool at a time. For each new public tool:

1. Inspect the installed OpenClaw source/schema or other authoritative implementation to determine the exact actions and arguments.
2. Add a feature folder under `src/tools/<tool>/` and create only the modules the feature needs. Do not duplicate native request validation in the bridge.
3. Register the definition in `src/mcp/tool-definitions.mjs` and the handler in `src/mcp/tool-dispatcher.mjs`.
4. Run syntax checks and a small set of representative, low-risk smoke tests. Do not delay publishing the known schema until every possible action has been exhaustively tested.
5. Surface native runtime errors rather than masking them or claiming actions succeeded without a confirming result.
6. Re-check imports and remove obsolete handlers when replacing an implementation; do not keep disconnected legacy copies without a concrete use.

## Browser-specific decisions

- Default to the existing Chrome extension profile `chrome`; do not silently switch to the isolated `openclaw` profile.
- Preserve the full native Browser action list and BrowserAct kind list from the installed OpenClaw source.
- Use snapshots and current element refs for UI operations where appropriate.
- Native permissions, extension attachment, and runtime configuration remain authoritative.

## Next

Choose the next OpenClaw tool, inspect its actual schema and implementation, create a new single-file module for it, register it, and validate representative actions before proceeding to another tool.
