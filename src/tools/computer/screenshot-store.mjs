import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 12;
const entries = new Map();

function prune(now = Date.now()) {
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id);
  }
  while (entries.size > DEFAULT_MAX_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
}

export function storeScreenshot(data, mimeType, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof data !== "string" || !data || !/^image\/(jpeg|png|webp|gif)$/.test(mimeType || "")) {
    throw new TypeError("A valid Base64 image and supported image MIME type are required.");
  }
  prune();
  const screenshotRef = "scr_" + randomBytes(12).toString("hex");
  entries.set(screenshotRef, {
    data,
    mimeType,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
  prune();
  return screenshotRef;
}

export function getScreenshot(screenshotRef) {
  if (typeof screenshotRef !== "string" || !/^scr_[a-f0-9]{24}$/.test(screenshotRef)) return null;
  prune();
  const entry = entries.get(screenshotRef);
  if (!entry) return null;
  return { data: entry.data, mimeType: entry.mimeType, createdAt: entry.createdAt, expiresAt: entry.expiresAt };
}

export function clearScreenshots() {
  entries.clear();
}
