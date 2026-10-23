import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { stateDir } from "../../config/runtime.mjs";

export const MAX_SEARCH_ENTRIES = 50_000;
export const MAX_SEARCH_RESULTS = 100;
export const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_GREP_LINE_CHARS = 600;

const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

function normalizeGlobPattern(pattern) {
  return pattern.replace(/\\/g, "/").replace(/^\.\//, "");
}

function findBraceGroup(pattern) {
  const start = pattern.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < pattern.length; i += 1) {
    if (pattern[i] === "{") depth += 1;
    else if (pattern[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = pattern.slice(start + 1, i);
        if (!body.includes(",")) return null;
        const choices = [];
        let nested = 0;
        let begin = 0;
        for (let j = 0; j < body.length; j += 1) {
          if (body[j] === "{") nested += 1;
          else if (body[j] === "}") nested -= 1;
          else if (body[j] === "," && nested === 0) {
            choices.push(body.slice(begin, j));
            begin = j + 1;
          }
        }
        choices.push(body.slice(begin));
        return { start, end: i, choices };
      }
    }
  }
  return null;
}

function expandBraces(pattern, maxExpansions = 64) {
  const pending = [pattern];
  const expanded = [];
  while (pending.length > 0) {
    const next = pending.pop();
    const group = findBraceGroup(next);
    if (!group) {
      expanded.push(next);
      if (expanded.length > maxExpansions) throw new Error("Glob pattern expands to too many alternatives.");
      continue;
    }
    for (const choice of group.choices) {
      pending.push(next.slice(0, group.start) + choice + next.slice(group.end + 1));
      if (pending.length + expanded.length > maxExpansions) {
        throw new Error("Glob pattern expands to too many alternatives.");
      }
    }
  }
  return expanded;
}

function globAlternativeToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0) {
        source += "\\[";
      } else {
        let body = pattern.slice(index + 1, end);
        if (body.startsWith("!")) body = "^" + body.slice(1);
        source += "[" + body.replace(/\\/g, "\\\\") + "]";
        index = end;
      }
    } else {
      source += /[|\\{}()[\]^$+?.]/.test(char) ? "\\" + char : char;
    }
  }
  source += "$";
  return new RegExp(source);
}

export function compileGlob(pattern, { matchBasename = false } = {}) {
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    throw new TypeError("pattern must be a non-empty string.");
  }
  if (pattern.includes("\0")) throw new TypeError("pattern must not contain NUL.");
  const normalized = normalizeGlobPattern(pattern.trim());
  const matchers = expandBraces(normalized).map(globAlternativeToRegExp);
  return (relativePath) => {
    const normalizedPath = normalizeGlobPattern(relativePath);
    if (matchers.some((matcher) => matcher.test(normalizedPath))) return true;
    if (matchBasename && !normalized.includes("/")) {
      const basename = path.posix.basename(normalizedPath);
      return matchers.some((matcher) => matcher.test(basename));
    }
    return false;
  };
}

function getWorkspaceRoot() {
  return process.env.OPENCLAW_WORKSPACE_DIR || path.join(stateDir, "workspace");
}

export async function resolveSearchPath(requestedPath, { allowFile = false } = {}) {
  if (requestedPath !== undefined && (typeof requestedPath !== "string" || requestedPath.trim().length === 0)) {
    throw new TypeError("path must be a non-empty string when provided.");
  }
  const workspace = getWorkspaceRoot();
  const candidate = requestedPath === undefined
    ? workspace
    : path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(workspace, requestedPath);

  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    const wrapped = new Error("Search path does not exist or is not accessible: " + candidate);
    wrapped.code = "SEARCH_PATH_UNAVAILABLE";
    wrapped.cause = error;
    throw wrapped;
  }
  const details = await stat(resolved);
  if (!details.isDirectory() && !(allowFile && details.isFile())) {
    throw new TypeError(allowFile ? "path must point to a file or directory." : "path must point to a directory.");
  }
  return { absolutePath: resolved, isFile: details.isFile() };
}

export async function collectSearchFiles(rootPath, { maxEntries = MAX_SEARCH_ENTRIES } = {}) {
  const rootInfo = await stat(rootPath);
  if (rootInfo.isFile()) {
    return {
      files: [{ absolutePath: rootPath, relativePath: path.basename(rootPath), size: rootInfo.size }],
      scannedEntries: 1,
      truncated: false,
    };
  }
  if (!rootInfo.isDirectory()) throw new TypeError("Search path must be a file or directory.");

  const files = [];
  const stack = [rootPath];
  let scannedEntries = 0;
  let truncated = false;
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > maxEntries) {
        truncated = true;
        stack.length = 0;
        break;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");
      let size = 0;
      try {
        size = (await stat(absolutePath)).size;
      } catch {
        continue;
      }
      files.push({ absolutePath, relativePath, size });
    }
  }
  return { files, scannedEntries: Math.min(scannedEntries, maxEntries), truncated };
}

export async function globSearch({ pattern, path: requestedPath } = {}) {
  const matcher = compileGlob(pattern);
  const root = await resolveSearchPath(requestedPath);
  const collected = await collectSearchFiles(root.absolutePath);
  const matches = [];
  for (const file of collected.files) {
    if (!matcher(file.relativePath)) continue;
    let modifiedAt = 0;
    try {
      modifiedAt = (await stat(file.absolutePath)).mtimeMs;
    } catch {
      continue;
    }
    matches.push({ path: file.absolutePath, relativePath: file.relativePath, modifiedAt });
  }
  matches.sort((left, right) => right.modifiedAt - left.modifiedAt
    || left.path.localeCompare(right.path));
  const limited = matches.slice(0, MAX_SEARCH_RESULTS);
  return {
    pattern,
    root: root.absolutePath,
    matches: limited,
    count: limited.length,
    totalMatchesFound: matches.length,
    truncated: collected.truncated || matches.length > MAX_SEARCH_RESULTS,
    scannedEntries: collected.scannedEntries,
  };
}

export async function grepSearch({ pattern, path: requestedPath, include } = {}) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new TypeError("pattern must be a non-empty regular expression.");
  }
  let matcher;
  try {
    matcher = new RegExp(pattern, "u");
  } catch (error) {
    const wrapped = new TypeError("pattern is not a valid JavaScript regular expression: " + error.message);
    wrapped.code = "SEARCH_INVALID_REGEX";
    throw wrapped;
  }
  const includeMatcher = include === undefined ? null : compileGlob(include, { matchBasename: true });
  const root = await resolveSearchPath(requestedPath, { allowFile: true });
  const collected = await collectSearchFiles(root.absolutePath);
  const matches = [];
  let skippedBinaryFiles = 0;
  let skippedLargeFiles = 0;
  let scannedFiles = 0;
  let truncated = collected.truncated;

  for (const file of collected.files) {
    if (includeMatcher && !includeMatcher(file.relativePath)) continue;
    if (file.size > MAX_GREP_FILE_BYTES) {
      skippedLargeFiles += 1;
      continue;
    }
    scannedFiles += 1;
    let buffer;
    try {
      buffer = await readFile(file.absolutePath);
    } catch {
      continue;
    }
    if (buffer.includes(0)) {
      skippedBinaryFiles += 1;
      continue;
    }
    const content = buffer.toString("utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!matcher.test(line)) continue;
      const isLineTruncated = line.length > MAX_GREP_LINE_CHARS;
      matches.push({
        path: file.absolutePath,
        relativePath: file.relativePath,
        lineNumber: index + 1,
        line: isLineTruncated ? line.slice(0, MAX_GREP_LINE_CHARS) : line,
        lineTruncated: isLineTruncated,
      });
      if (matches.length > MAX_SEARCH_RESULTS) {
        truncated = true;
        break;
      }
    }
    if (matches.length > MAX_SEARCH_RESULTS) break;
  }

  const limited = matches.slice(0, MAX_SEARCH_RESULTS);
  return {
    pattern,
    root: root.absolutePath,
    ...(include === undefined ? {} : { include }),
    matches: limited,
    count: limited.length,
    truncated,
    scannedEntries: collected.scannedEntries,
    scannedFiles,
    skippedBinaryFiles,
    skippedLargeFiles,
  };
}
