import { fileSearchToolDefinitions } from "./schema.mjs";
import { globSearch, grepSearch } from "./engine.mjs";

const toolNames = new Set(fileSearchToolDefinitions.map((definition) => definition.name));

function errorResult(code, message) {
  return {
    isError: true,
    diagnostics: { stage: "search_validation", code },
    content: [{ type: "text", text: message }],
  };
}

function formatGlobResult(result) {
  const lines = result.matches.map((match) => match.path);
  if (lines.length === 0) lines.push("No files matched the glob pattern.");
  if (result.truncated) lines.push("(Results truncated; narrow the search path or pattern.)");
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      pattern: result.pattern,
      root: result.root,
      matches: result.matches,
      count: result.count,
      totalMatchesFound: result.totalMatchesFound,
      truncated: result.truncated,
      scannedEntries: result.scannedEntries,
    },
  };
}

function formatGrepResult(result) {
  const lines = result.matches.map((match) =>
    match.path + ":" + match.lineNumber + ":" + match.line
      + (match.lineTruncated ? " … [line truncated]" : "")
  );
  if (lines.length === 0) lines.push("No matching lines found.");
  if (result.truncated) lines.push("(Results truncated; narrow the search path, pattern, or include filter.)");
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      pattern: result.pattern,
      root: result.root,
      ...(result.include === undefined ? {} : { include: result.include }),
      matches: result.matches,
      count: result.count,
      truncated: result.truncated,
      scannedEntries: result.scannedEntries,
      scannedFiles: result.scannedFiles,
      skippedBinaryFiles: result.skippedBinaryFiles,
      skippedLargeFiles: result.skippedLargeFiles,
    },
  };
}

export function createFileSearchToolHandler({ searchFiles = globSearch, searchContent = grepSearch } = {}) {
  return async function handleFileSearchTool(name, args = {}) {
    if (!toolNames.has(name)) return undefined;
    try {
      if (name === "openclaw_glob") return formatGlobResult(await searchFiles(args));
      if (name === "openclaw_grep") return formatGrepResult(await searchContent(args));
      return undefined;
    } catch (error) {
      return errorResult(error?.code ?? "SEARCH_FAILED", error instanceof Error ? error.message : String(error));
    }
  };
}

export const handleFileSearchTool = createFileSearchToolHandler();
