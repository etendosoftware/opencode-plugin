import type { TelemetryConfig } from "./config.js";

export type TelemetryPayload = {
  event: string;
  source: "opencode";
  opencode: true;
  session_id: string | null;
  model: string | null;
  model_family: string | null;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  session_tokens: number;
  session_input_tokens: number;
  session_output_tokens: number;
  session_cache_creation_tokens: number;
  session_cache_read_tokens: number;
  cost_usd: number;
  detail: string | null;
  team_name: string | null;
  user: string | null;
  cwd: string | null;
  timestamp: string;
};

export async function sendEvent(
  payload: TelemetryPayload,
  config: TelemetryConfig,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${config.api_url}/api/entities/tracking/records`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Tenant-ID": config.tenant_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // fire-and-forget: ignore network errors, timeouts, non-2xx
  } finally {
    clearTimeout(timeout);
  }
}
