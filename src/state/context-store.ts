import path from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { ExtractedMessage } from "../claude/types.js";

const STATE_DIR_NAME = ".claude-bridge-state";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type StoredContext = {
  importedContext: string;
  importedContextShort?: string;
  sourceSessionId: string;
  importedAt: string;
  recentMessages?: ExtractedMessage[];
};

export type ContextStore = {
  get(openCodeSessionId: string): string | undefined;
  getStructured(openCodeSessionId: string): StoredContext | undefined;
  save(openCodeSessionId: string, stored: StoredContext): Promise<void>;
  remove(openCodeSessionId: string): Promise<void>;
};

function stateDirFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".opencode", STATE_DIR_NAME);
}

function fileFor(workspaceRoot: string, openCodeSessionId: string): string {
  return path.join(stateDirFor(workspaceRoot), `${openCodeSessionId}.json`);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function pruneOldEntries(dir: string): Promise<void> {
  const now = Date.now();
  let entries: string[];
  try {
    entries = (await readdir(dir)) as string[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    try {
      const stats = await stat(filePath);
      if (now - stats.mtimeMs > MAX_AGE_MS) {
        await rm(filePath, { force: true });
      }
    } catch {
      // ignore individual file errors
    }
  }
}

export async function createContextStore(workspaceRoot: string): Promise<ContextStore> {
  const dir = stateDirFor(workspaceRoot);
  const memory = new Map<string, StoredContext>();

  if (await exists(dir)) {
    await pruneOldEntries(dir);
    const entries = (await readdir(dir)) as string[];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(dir, entry), "utf8");
        const parsed = JSON.parse(raw) as StoredContext;
        if (parsed?.importedContext) {
          memory.set(entry.replace(/\.json$/, ""), parsed);
        }
      } catch {
        // ignore corrupted entries
      }
    }
  }

  return {
    get(openCodeSessionId) {
      return memory.get(openCodeSessionId)?.importedContext;
    },
    getStructured(openCodeSessionId) {
      return memory.get(openCodeSessionId);
    },
    async save(openCodeSessionId, stored) {
      memory.set(openCodeSessionId, stored);
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(workspaceRoot, openCodeSessionId), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    },
    async remove(openCodeSessionId) {
      memory.delete(openCodeSessionId);
      await rm(fileFor(workspaceRoot, openCodeSessionId), { force: true });
    },
  };
}
