import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

const LOG_DIR_NAME = ".claude-bridge-state";
const LOG_FILE_NAME = "debug.log";

export type DebugLogger = {
  enabled: boolean;
  log(event: string, detail?: Record<string, unknown>): void;
};

export function createDebugLogger(workspaceRoot: string): DebugLogger {
  const enabled = process.env.OPENCODE_CLAUDE_BRIDGE_DEBUG === "1"
    || process.env.OPENCODE_CLAUDE_BRIDGE_REPLAY === "1";
  const filePath = path.join(workspaceRoot, ".opencode", LOG_DIR_NAME, LOG_FILE_NAME);
  let ensured = false;

  async function write(line: string): Promise<void> {
    if (!ensured) {
      await mkdir(path.dirname(filePath), { recursive: true });
      ensured = true;
    }
    await appendFile(filePath, line, "utf8");
  }

  return {
    enabled,
    log(event, detail) {
      if (!enabled) return;
      const timestamp = new Date().toISOString();
      const detailStr = detail ? ` ${JSON.stringify(detail)}` : "";
      const line = `[${timestamp}] ${event}${detailStr}\n`;
      write(line).catch(() => {
        // swallow errors, logging must never break the plugin
      });
    },
  };
}
