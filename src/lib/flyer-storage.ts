import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { AppError } from "./errors";

// Flyers are written to a writable temp dir on the Railway container and
// served back via the /flyers/:filename route. Files expire after TTL_MS so
// the disk doesn't grow unbounded between redeploys. Google Chat fetches and
// caches the image at card-post time, so the original URL becoming a 404
// later is not an issue for cards already in conversation history.

const FLYERS_DIR = "/tmp/flyers";
const TTL_MS         = 60 * 60 * 1000;       // 1 hour
const CLEANUP_EVERY  = 10 * 60 * 1000;       // 10 minutes

let dirReady: Promise<void> | null = null;

async function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = fs.mkdir(FLYERS_DIR, { recursive: true }).then(() => undefined);
  }
  return dirReady;
}

/** Generate a URL-safe random filename. */
function randomName(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`;
}

/** Write a PNG buffer to disk and return its public URL. */
export async function saveFlyer(pngBuffer: Buffer): Promise<string> {
  await ensureDir();
  const filename = randomName();
  try {
    await fs.writeFile(path.join(FLYERS_DIR, filename), pngBuffer);
  } catch (err) {
    throw new AppError(500, "Failed to save the generated flyer.", "FLYER_WRITE_FAILED", err);
  }
  return `${env.PUBLIC_BASE_URL}/flyers/${filename}`;
}

/** Read a flyer back from disk. Returns null if not found or filename unsafe. */
export async function readFlyer(filename: string): Promise<Buffer | null> {
  // Strict allowlist — defence against path traversal
  if (!/^[A-Za-z0-9_-]+\.png$/.test(filename)) return null;
  try {
    return await fs.readFile(path.join(FLYERS_DIR, filename));
  } catch {
    return null;
  }
}

/** Delete files older than TTL_MS. Safe to call repeatedly. */
async function sweep(): Promise<void> {
  try {
    await ensureDir();
    const files = await fs.readdir(FLYERS_DIR);
    const now = Date.now();
    await Promise.all(
      files.map(async (name) => {
        const fp = path.join(FLYERS_DIR, name);
        try {
          const stat = await fs.stat(fp);
          if (now - stat.mtimeMs > TTL_MS) await fs.unlink(fp);
        } catch {
          // best-effort: ignore individual file errors
        }
      }),
    );
  } catch (err) {
    console.error("[flyers] cleanup failed:", err);
  }
}

/** Kick off the periodic cleanup loop. Call once at server startup. */
export function startFlyerCleanup(): void {
  void sweep();
  setInterval(() => void sweep(), CLEANUP_EVERY).unref();
}
