import { homedir } from "node:os";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type {
  ClaudeSessionIndexEntry,
  ClaudeSessionRecord,
} from "./types.js";

const CLAUDE_PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

function projectPathToKey(projectPath: string): string {
  const normalized = path.resolve(projectPath);
  return normalized.replaceAll(path.sep, "-");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function sortSessions(a: ClaudeSessionRecord, b: ClaudeSessionRecord): number {
  const aTime = Date.parse(a.modified ?? "") || 0;
  const bTime = Date.parse(b.modified ?? "") || 0;
  return bTime - aTime;
}

async function loadProjectSessions(projectPath: string): Promise<ClaudeSessionRecord[]> {
  const projectKey = projectPathToKey(projectPath);
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectKey);
  if (!(await exists(projectDir))) {
    return [];
  }

  const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
  if (await exists(sessionsIndexPath)) {
    const parsed = JSON.parse(await readFile(sessionsIndexPath, "utf8")) as {
      entries?: ClaudeSessionIndexEntry[];
    };
    return (parsed.entries ?? [])
      .filter((entry) => !entry.isSidechain && entry.sessionId && entry.fullPath)
      .map((entry) => ({
        sessionId: entry.sessionId,
        transcriptPath: entry.fullPath,
        projectPath,
        projectKey,
        summary: entry.summary,
        firstPrompt: entry.firstPrompt,
        modified: entry.modified,
        gitBranch: entry.gitBranch,
        messageCount: entry.messageCount,
      }))
      .sort(sortSessions);
  }

  const entries = await readdir(projectDir, { withFileTypes: true });
  const sessions: ClaudeSessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const transcriptPath = path.join(projectDir, entry.name);
    const stats = await stat(transcriptPath);
    sessions.push({
      sessionId: entry.name.replace(/\.jsonl$/, ""),
      transcriptPath,
      projectPath,
      projectKey,
      modified: stats.mtime.toISOString(),
    });
  }

  return sessions.sort(sortSessions);
}

export async function resolveLatestSession(projectPath: string): Promise<ClaudeSessionRecord | null> {
  const sessions = await loadProjectSessions(projectPath);
  return sessions[0] ?? null;
}

export async function resolveSessionById(sessionId: string): Promise<ClaudeSessionRecord | null> {
  const projectDirs = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const transcriptPath = path.join(CLAUDE_PROJECTS_DIR, entry.name, `${sessionId}.jsonl`);
    if (!(await exists(transcriptPath))) {
      continue;
    }

    const sessionsIndexPath = path.join(CLAUDE_PROJECTS_DIR, entry.name, "sessions-index.json");
    let indexed: ClaudeSessionIndexEntry | undefined;
    if (await exists(sessionsIndexPath)) {
      const parsed = JSON.parse(await readFile(sessionsIndexPath, "utf8")) as {
        entries?: ClaudeSessionIndexEntry[];
      };
      indexed = parsed.entries?.find((item) => item.sessionId === sessionId);
    }

    const projectPath = indexed?.projectPath ?? `unknown (Claude project key: ${entry.name})`;
    return {
      sessionId,
      transcriptPath,
      projectPath,
      projectKey: entry.name,
      summary: indexed?.summary,
      firstPrompt: indexed?.firstPrompt,
      modified: indexed?.modified,
      gitBranch: indexed?.gitBranch,
      messageCount: indexed?.messageCount,
    };
  }

  return null;
}
