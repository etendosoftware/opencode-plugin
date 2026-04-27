import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

type DebugLogger = {
  log(event: string, payload?: Record<string, unknown>): void;
};

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

export async function loadTelemetryConfig(cwd: string, debug?: DebugLogger): Promise<TelemetryConfig | null> {
  if (process.env.OPENCODE_FYSO_TELEMETRY === "0") {
    debug?.log("telemetry.config.disabled", { reason: "env_disabled" });
    return null;
  }

  let fyso: FysoConfigFile;
  const fysoConfigPath = join(homedir(), ".fyso", "config.json");
  try {
    const raw = await readFile(fysoConfigPath, "utf-8");
    fyso = JSON.parse(raw) as FysoConfigFile;
    debug?.log("telemetry.config.fyso_loaded", {
      path: fysoConfigPath,
      hasToken: !!fyso.token,
      hasTenantId: !!fyso.tenant_id,
      hasApiUrl: !!fyso.api_url,
      hasUserEmail: !!fyso.user_email,
    });
  } catch (error) {
    debug?.log("telemetry.config.disabled", {
      reason: "missing_or_invalid_fyso_config",
      path: fysoConfigPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!fyso.token || !fyso.tenant_id || !fyso.api_url) {
    debug?.log("telemetry.config.disabled", {
      reason: "incomplete_fyso_config",
      path: fysoConfigPath,
      hasToken: !!fyso.token,
      hasTenantId: !!fyso.tenant_id,
      hasApiUrl: !!fyso.api_url,
    });
    return null;
  }

  let team_name: string | null = null;
  const teamConfigPath = join(cwd, ".fyso", "team.json");
  try {
    const raw = await readFile(teamConfigPath, "utf-8");
    const team = JSON.parse(raw) as TeamConfigFile;
    team_name = team.team_name ?? null;
    debug?.log("telemetry.config.team_loaded", {
      path: teamConfigPath,
      teamName: team_name,
    });
  } catch (error) {
    debug?.log("telemetry.config.team_missing", {
      path: teamConfigPath,
      error: error instanceof Error ? error.message : String(error),
    });
    // no team config, continue without it
  }

  debug?.log("telemetry.config.enabled", {
    apiUrl: fyso.api_url,
    tenantId: fyso.tenant_id,
    hasUser: !!fyso.user_email,
    teamName: team_name,
    cwd,
  });

  return {
    token: fyso.token,
    tenant_id: fyso.tenant_id,
    api_url: fyso.api_url,
    user: fyso.user_email ?? null,
    team_name,
    cwd,
  };
}
