import type { EventMessageUpdated, AssistantMessage } from "@opencode-ai/sdk";
import type { TelemetryConfig } from "./config.js";
import type { TelemetryPayload } from "./client.js";
import type { SessionTotals, TokenDelta } from "./tracker.js";
import { sendEvent } from "./client.js";
import { SessionTracker, ZERO_TOTALS } from "./tracker.js";

export type TelemetryContext = {
  config: TelemetryConfig;
  tracker: SessionTracker;
};

export function createTelemetryContext(config: TelemetryConfig): TelemetryContext {
  return { config, tracker: new SessionTracker() };
}

export function modelFamily(modelId: string): string | null {
  if (modelId.includes("opus")) return "opus";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("haiku")) return "haiku";
  return null;
}

export function buildPayload(
  eventName: string,
  sessionId: string,
  modelId: string,
  delta: TokenDelta,
  totals: SessionTotals,
  detail: string | null,
  config: TelemetryConfig,
): TelemetryPayload {
  return {
    event: eventName,
    source: "opencode",
    opencode: true,
    session_id: sessionId || null,
    model: modelId || null,
    model_family: modelId ? modelFamily(modelId) : null,
    tokens: delta.input + delta.output + delta.cache_creation + delta.cache_read,
    input_tokens: delta.input,
    output_tokens: delta.output,
    cache_creation_tokens: delta.cache_creation,
    cache_read_tokens: delta.cache_read,
    session_tokens: totals.tokens,
    session_input_tokens: totals.input_tokens,
    session_output_tokens: totals.output_tokens,
    session_cache_creation_tokens: totals.cache_creation_tokens,
    session_cache_read_tokens: totals.cache_read_tokens,
    cost_usd: delta.cost,
    detail,
    team_name: config.team_name,
    user: config.user,
    cwd: config.cwd,
    timestamp: new Date().toISOString(),
  };
}

const ZERO_DELTA: TokenDelta = { input: 0, output: 0, cache_creation: 0, cache_read: 0, cost: 0 };

export async function onMessageCompleted(
  event: EventMessageUpdated,
  ctx: TelemetryContext,
): Promise<void> {
  if (event.properties.info.role !== "assistant") return;
  const msg = event.properties.info as AssistantMessage;

  const sessionId = msg.sessionID;
  const isNew = ctx.tracker.isNew(sessionId);

  const delta: TokenDelta = {
    input: msg.tokens.input,
    output: msg.tokens.output,
    cache_creation: msg.tokens.cache.write,
    cache_read: msg.tokens.cache.read,
    cost: msg.cost ?? 0,
  };

  // Register session synchronously before any async call to prevent double session_start
  const totals = ctx.tracker.add(sessionId, delta);

  if (isNew) {
    await sendEvent(
      buildPayload("opencode_session_start", sessionId, msg.modelID, ZERO_DELTA, { ...ZERO_TOTALS }, null, ctx.config),
      ctx.config,
    );
  }

  await sendEvent(
    buildPayload("opencode_turn", sessionId, msg.modelID, delta, totals, null, ctx.config),
    ctx.config,
  );
}

export async function onToolUsed(
  sessionId: string,
  detail: string,
  ctx: TelemetryContext,
): Promise<void> {
  const totals = ctx.tracker.get(sessionId) ?? { ...ZERO_TOTALS };
  await sendEvent(
    buildPayload("opencode_tool_use", sessionId, "", ZERO_DELTA, totals, detail, ctx.config),
    ctx.config,
  );
}
