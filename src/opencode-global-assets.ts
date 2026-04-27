import { cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DebugLogger = {
  log(event: string, payload?: Record<string, unknown>): void;
};

function getPackagedAssetsRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", ".opencode");
}

function getGlobalOpencodeRoot(): string {
  return path.join(homedir(), ".config", "opencode");
}

async function syncDirectoryIfPresent(sourceDir: string, targetDir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  if (entries.length === 0) {
    return 0;
  }

  await mkdir(targetDir, { recursive: true });

  await Promise.all(entries.map((entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    return cp(sourcePath, targetPath, { recursive: true, force: true });
  }));

  return entries.length;
}

export async function installGlobalOpencodeAssets(debug: DebugLogger): Promise<void> {
  const packagedRoot = getPackagedAssetsRoot();
  const globalRoot = getGlobalOpencodeRoot();
  const commandsSource = path.join(packagedRoot, "commands");
  const skillsSource = path.join(packagedRoot, "skills");
  const commandsTarget = path.join(globalRoot, "commands");
  const skillsTarget = path.join(globalRoot, "skills");

  try {
    const [commandCount, skillCount] = await Promise.all([
      syncDirectoryIfPresent(commandsSource, commandsTarget),
      syncDirectoryIfPresent(skillsSource, skillsTarget),
    ]);

    debug.log("plugin.global_assets_synced", {
      packagedRoot,
      globalRoot,
      commandCount,
      skillCount,
    });
  } catch (error) {
    debug.log("plugin.global_assets_sync_error", {
      packagedRoot,
      globalRoot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
