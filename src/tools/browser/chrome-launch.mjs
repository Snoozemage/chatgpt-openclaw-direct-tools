import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export function chromeLaunchCandidates(env = process.env) {
  const candidates = [
    env.PROGRAMFILES && join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] && join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.filter(Boolean);
}

export async function resolveChromeLaunchConfig({ env = process.env, exists = existsSync } = {}) {
  if (process.platform !== "win32") throw new Error("Automatic personal Chrome launch is supported on Windows only.");

  const executable = chromeLaunchCandidates(env).find((candidate) => exists(candidate));
  if (!executable) throw new Error("Could not locate chrome.exe in the standard Google Chrome installation paths.");

  const userDataDir = join(env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
  const localStatePath = join(userDataDir, "Local State");
  let profileDirectory = "Default";
  try {
    const localState = JSON.parse(await readFile(localStatePath, "utf8"));
    const lastUsed = localState?.profile?.last_used;
    if (typeof lastUsed === "string" && lastUsed.trim() && exists(join(userDataDir, lastUsed))) {
      profileDirectory = lastUsed;
    }
  } catch {
    // Use Chrome's conventional Default profile if Local State cannot be read.
  }

  return { executable, userDataDir, profileDirectory };
}

async function isChromeRunning() {
  try {
    const { stdout } = await execFile("tasklist.exe", ["/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"], {
      windowsHide: true,
      timeout: 3000,
      encoding: "utf8",
    });
    return stdout.split("\n").some((line) => line.split(",")[0].replaceAll('"', "").trim().toLowerCase() === "chrome.exe");
  } catch {
    return false;
  }
}

export async function ensurePersonalChromeRunning() {
  if (process.platform !== "win32" || await isChromeRunning()) return { launched: false };

  const config = await resolveChromeLaunchConfig();
  await new Promise((resolve, reject) => {
    const child = spawn(config.executable, [
      `--user-data-dir=${config.userDataDir}`,
      `--profile-directory=${config.profileDirectory}`,
      "--new-window",
      "about:blank",
    ], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

  // Give Chrome time to start its extension before the native Browser request.
  await new Promise((resolve) => setTimeout(resolve, 1800));
  return { launched: true, profileDirectory: config.profileDirectory };
}
