import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

type FysoConfigFile = {
  token?: string;
  tenant_id?: string;
  api_url?: string;
  user_email?: string;
};

type TeamConfigFile = {
  team_name?: string;
};

export type TelemetryConfig = {
  token: string;
  tenant_id: string;
  api_url: string;
  user: string | null;
  team_name: string | null;
  cwd: string;
};

export async function loadTelemetryConfig(cwd: string): Promise<TelemetryConfig | null> {
  if (process.env.OPENCODE_FYSO_TELEMETRY === "0") return null;

  let fyso: FysoConfigFile;
  try {
    const raw = await readFile(join(homedir(), ".fyso", "config.json"), "utf-8");
    fyso = JSON.parse(raw) as FysoConfigFile;
  } catch {
    return null;
  }

  if (!fyso.token || !fyso.tenant_id || !fyso.api_url) return null;

  let team_name: string | null = null;
  try {
    const raw = await readFile(join(cwd, ".fyso", "team.json"), "utf-8");
    const team = JSON.parse(raw) as TeamConfigFile;
    team_name = team.team_name ?? null;
  } catch {
    // no team config, continue without it
  }

  return {
    token: fyso.token,
    tenant_id: fyso.tenant_id,
    api_url: fyso.api_url,
    user: fyso.user_email ?? null,
    team_name,
    cwd,
  };
}
