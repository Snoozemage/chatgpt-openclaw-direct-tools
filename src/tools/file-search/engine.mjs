import { spawn } from "node:child_process";
import { glob as nodeGlob, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { stateDir } from "../../config/runtime.mjs";

const MAX_GLOB_MATCHES_TO_SCAN = 50_000;
export const MAX_SEARCH_RESULTS = 100;
export const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_GREP_LINE_CHARS = 600;

const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

function normalizeGlobPattern(pattern) {
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    throw new TypeError("pattern must be a non-empty string.");
  }
  if (pattern.includes("\0")) throw new TypeError("pattern must not contain NUL.");

  const normalized = pattern.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(pattern)) {
    throw new TypeError("glob pattern must be relative to the search root.");
  }
  if (/(^|[/{,])\.\.(?=\/|[,}]|$)/.test(normalized)) {
    throw new TypeError("glob pattern must not contain '..' path segments.");
  }
  return normalized;
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

function isWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
}

export async function globSearch({ pattern, path: requestedPath } = {}) {
  const normalizedPattern = normalizeGlobPattern(pattern);
  const root = await resolveSearchPath(requestedPath);
  const matches = [];
  let matchesScanned = 0;
  let scanTruncated = false;

  const excludeIgnoredDirectories = (entry) => {
    const value = typeof entry === "string"
      ? entry
      : entry && typeof entry.name === "string"
        ? path.join(entry.parentPath ?? entry.path ?? "", entry.name)
        : String(entry);
    return value.split(/[\\/]+/).some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
  };

  for await (const relativePathValue of nodeGlob(normalizedPattern, {
    cwd: root.absolutePath,
    exclude: excludeIgnoredDirectories,
  })) {
    matchesScanned += 1;
    if (matchesScanned > MAX_GLOB_MATCHES_TO_SCAN) {
      scanTruncated = true;
      break;
    }

    const relativePath = String(relativePathValue);
    const absolutePath = path.resolve(root.absolutePath, relativePath);
    if (!isWithinRoot(root.absolutePath, absolutePath)) continue;

    let details;
    try {
      details = await lstat(absolutePath);
    } catch {
      continue;
    }
    // Keep the previous behavior: return regular files only and never follow symlinks.
    if (details.isSymbolicLink() || !details.isFile()) continue;

    matches.push({
      path: absolutePath,
      relativePath: path.relative(root.absolutePath, absolutePath).split(path.sep).join("/"),
      modifiedAt: details.mtimeMs,
    });
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
    truncated: scanTruncated || matches.length > MAX_SEARCH_RESULTS,
  };
}

function decodeJsonData(data) {
  if (typeof data?.text === "string") return data.text;
  if (typeof data?.bytes === "string") return Buffer.from(data.bytes, "base64").toString("utf8");
  return "";
}

function makeRipgrepError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function classifyRipgrepFailure(stderr) {
  if (/\bregex parse error\b|\bunclosed character class\b|\binvalid regex\b|\bregex syntax\b/i.test(stderr)) {
    return "SEARCH_INVALID_REGEX";
  }
  return "SEARCH_RIPGREP_FAILED";
}

export function createRipgrepSearch({
  executable = process.env.OPENCLAW_RIPGREP_PATH || "rg",
  spawnProcess = spawn,
} = {}) {
  return async function grepSearch({ pattern, path: requestedPath, include } = {}) {
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new TypeError("pattern must be a non-empty ripgrep regular expression.");
    }
    if (pattern.includes("\0")) {
      throw new TypeError("pattern must not contain NUL.");
    }
    if (include !== undefined && (typeof include !== "string" || include.trim().length === 0 || include.includes("\0"))) {
      throw new TypeError("include must be a non-empty glob pattern when provided.");
    }

    const root = await resolveSearchPath(requestedPath, { allowFile: true });
    if (root.isFile && (await stat(root.absolutePath)).size > MAX_GREP_FILE_BYTES) {
      return {
        pattern,
        root: root.absolutePath,
        ...(include === undefined ? {} : { include }),
        matches: [],
        count: 0,
        truncated: false,
      };
    }
    const searchCwd = root.isFile ? path.dirname(root.absolutePath) : root.absolutePath;
    const searchTarget = root.isFile ? path.basename(root.absolutePath) : ".";
    const args = [
      "--no-config",
      "--json",
      "--line-buffered",
      "--case-sensitive",
      "--max-filesize",
      String(MAX_GREP_FILE_BYTES),
    ];

    if (include !== undefined) args.push("--glob", include);
    // Put hard exclusions last so a caller-supplied include glob cannot override them.
    args.push("--glob", "!**/.git/**", "--glob", "!**/node_modules/**");
    args.push("--regexp", pattern, "--", searchTarget);

    let child;
    try {
      child = spawnProcess(executable, args, {
        cwd: searchCwd,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      throw makeRipgrepError(
        "Could not start ripgrep. Install ripgrep and ensure rg.exe is on PATH, or set OPENCLAW_RIPGREP_PATH.",
        "SEARCH_RIPGREP_UNAVAILABLE",
        cause,
      );
    }

    const matches = [];
    let truncated = false;
    let stoppedForLimit = false;
    let spawnError = null;
    let parseError = null;
    let stderr = "";
    let summaryStats = null;

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.slice(0, 16_384 - stderr.length);
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (jsonLine) => {
      if (parseError || stoppedForLimit) return;
      let message;
      try {
        message = JSON.parse(jsonLine);
      } catch (cause) {
        parseError = makeRipgrepError("ripgrep returned invalid JSON output.", "SEARCH_RIPGREP_FAILED", cause);
        child.kill();
        return;
      }

      if (message.type === "summary") {
        summaryStats = message.data?.stats ?? null;
        return;
      }
      if (message.type !== "match") return;

      const data = message.data ?? {};
      const rawPath = decodeJsonData(data.path);
      const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(searchCwd, rawPath);
      const rawLine = decodeJsonData(data.lines);
      const line = rawLine.replace(/\r?\n$/, "");
      const lineTruncated = line.length > MAX_GREP_LINE_CHARS;
      matches.push({
        path: absolutePath,
        relativePath: path.relative(root.isFile ? path.dirname(root.absolutePath) : root.absolutePath, absolutePath)
          .split(path.sep).join("/"),
        lineNumber: data.line_number,
        line: lineTruncated ? line.slice(0, MAX_GREP_LINE_CHARS) : line,
        lineTruncated,
      });
      if (matches.length > MAX_SEARCH_RESULTS) {
        truncated = true;
        stoppedForLimit = true;
        child.kill();
      }
    });

    child.once("error", (cause) => {
      spawnError = cause;
    });
    const exit = await new Promise((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    lines.close();

    if (spawnError) {
      throw makeRipgrepError(
        spawnError.code === "ENOENT"
          ? "ripgrep executable was not found. Install ripgrep and ensure rg.exe is on PATH, or set OPENCLAW_RIPGREP_PATH."
          : "Could not start ripgrep: " + spawnError.message,
        spawnError.code === "ENOENT" ? "SEARCH_RIPGREP_UNAVAILABLE" : "SEARCH_RIPGREP_FAILED",
        spawnError,
      );
    }
    if (parseError) throw parseError;

    // ripgrep exits 1 for a valid search with no matches.
    if (exit.code !== 0 && exit.code !== 1 && !stoppedForLimit) {
      const detail = stderr.trim();
      throw makeRipgrepError(
        detail || ("ripgrep exited with code " + String(exit.code) + (exit.signal ? " (signal " + exit.signal + ")" : "")),
        classifyRipgrepFailure(detail),
      );
    }

    return {
      pattern,
      root: root.absolutePath,
      ...(include === undefined ? {} : { include }),
      matches: matches.slice(0, MAX_SEARCH_RESULTS),
      count: Math.min(matches.length, MAX_SEARCH_RESULTS),
      truncated,
      ...(Number.isInteger(summaryStats?.searches) && !stoppedForLimit
        ? { scannedFiles: summaryStats.searches }
        : {}),
    };
  };
}

export const grepSearch = createRipgrepSearch();
