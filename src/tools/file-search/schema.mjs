const text = (description) => ({ type: "string", description });

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export const fileSearchToolDefinitions = [
  {
    name: "openclaw_glob",
    title: "Find Files",
    description: "Find files using glob patterns without a shell. Examples: **/*.ts, src/**/*.tsx, or *.{js,mjs}. The path defaults to the OpenClaw workspace. Returns up to 100 absolute paths, newest modified first. Git internals and node_modules directories are skipped; symlink directories are not followed.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        pattern: text("Required glob pattern, relative to the search root. Use / separators in patterns. Supports *, ?, **, character classes, and brace alternatives such as *.{js,ts}."),
        path: text("Optional directory to search, absolute or relative to the OpenClaw workspace. Defaults to the workspace root."),
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "openclaw_grep",
    title: "Search File Contents",
    description: "Search file contents with a regular expression without a shell. Returns up to 100 matching lines with absolute file paths and line numbers. The path defaults to the OpenClaw workspace and may be a file or directory. Use include to limit which files are searched, for example *.ts or *.{ts,tsx}. Git internals and node_modules directories are skipped; binary and files larger than 2 MiB are skipped. Matching is line-based, case-sensitive, and does not span multiple lines.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      type: "object",
      properties: {
        pattern: text("Required JavaScript-compatible regular expression to match within each line. Matching is case-sensitive."),
        path: text("Optional file or directory to search, absolute or relative to the OpenClaw workspace. Defaults to the workspace root."),
        include: text("Optional glob filter for files, such as *.ts, *.{ts,tsx}, or src/**/*.mjs. Patterns without / match basenames at any depth."),
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
];
