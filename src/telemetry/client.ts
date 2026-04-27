import type { TelemetryConfig } from "./config.js";

type DebugLogger = {
  log(event: string, payload?: Record<string, unknown>): void;
};

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
  session_cost_usd: number;
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
  debug?: DebugLogger,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const url = `${config.api_url}/api/entities/tracking/records`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Tenant-ID": config.tenant_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let responseText = "";
    try {
      responseText = (await response.text()).trim();
    } catch {
      // ignore body read errors in debug logging
    }

    debug?.log(response.ok ? "telemetry.send.success" : "telemetry.send.failed", {
      event: payload.event,
      url,
      status: response.status,
      statusText: response.statusText,
      response: responseText ? responseText.slice(0, 500) : null,
    });
  } catch (error) {
    debug?.log("telemetry.send.error", {
      event: payload.event,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    // fire-and-forget: ignore network errors, timeouts, non-2xx
  } finally {
    clearTimeout(timeout);
  }
}
