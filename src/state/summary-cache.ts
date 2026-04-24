import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";

const CACHE_DIR_NAME = ".claude-bridge-cache";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type SummaryCache = {
  get(key: SummaryKey): Promise<string | undefined>;
  set(key: SummaryKey, value: string): Promise<void>;
};

export type SummaryKey = {
  sessionId: string;
  transcriptMtimeMs: number;
  olderCount: number;
};

function cacheDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".opencode", CACHE_DIR_NAME);
}

function keyToFilename(key: SummaryKey): string {
  return `${key.sessionId}-${Math.floor(key.transcriptMtimeMs)}-${key.olderCount}.md`;
}

async function pruneOld(dir: string): Promise<void> {
  const now = Date.now();
  let entries: string[];
  try {
    entries = (await readdir(dir)) as string[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    try {
      const stats = await stat(filePath);
      if (now - stats.mtimeMs > MAX_AGE_MS) {
        await rm(filePath, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

export async function createSummaryCache(workspaceRoot: string): Promise<SummaryCache> {
  const dir = cacheDir(workspaceRoot);
  await pruneOld(dir);

  return {
    async get(key) {
      try {
        const raw = await readFile(path.join(dir, keyToFilename(key)), "utf8");
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, keyToFilename(key)), `${value.trim()}\n`, "utf8");
    },
  };
}
