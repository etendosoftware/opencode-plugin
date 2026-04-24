import type { EventMessageUpdated, AssistantMessage } from "@opencode-ai/sdk";
import type { TelemetryConfig } from "./config.js";
import type { TelemetryPayload } from "./client.js";
import type { SessionTotals, TokenDelta } from "./tracker.js";
import { sendEvent } from "./client.js";
import { SessionTracker, ZERO_TOTALS } from "./tracker.js";

export type ModelCostRates = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type TelemetryContext = {
  config: TelemetryConfig;
  tracker: SessionTracker;
  modelRates: Map<string, ModelCostRates>;
};

export function createTelemetryContext(config: TelemetryConfig): TelemetryContext {
  return { config, tracker: new SessionTracker(), modelRates: new Map() };
}

export function setModelRates(ctx: TelemetryContext, modelId: string, rates: ModelCostRates): void {
  ctx.modelRates.set(modelId, rates);
}

function calculateCost(delta: Omit<TokenDelta, "cost">, rates: ModelCostRates): number {
  return (
    (delta.input / 1_000_000) * rates.input +
    (delta.output / 1_000_000) * rates.output +
    (delta.cache_creation / 1_000_000) * rates.cache_write +
    (delta.cache_read / 1_000_000) * rates.cache_read
  );
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
    session_cost_usd: totals.cost_usd,
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
  rawEvent: unknown,
  ctx: TelemetryContext,
): Promise<void> {
  if (typeof rawEvent !== "object" || rawEvent === null) return;
  const e = rawEvent as { type?: string };
  if (e.type !== "message.updated") return;
  const event = rawEvent as EventMessageUpdated;
  if (event.properties.info.role !== "assistant") return;
  const msg = event.properties.info as AssistantMessage;

  if (ctx.tracker.hasProcessed(msg.id)) return;

  const sessionId = msg.sessionID;
  const isNew = ctx.tracker.isNew(sessionId);

  const tokenDelta = {
    input: msg.tokens.input,
    output: msg.tokens.output,
    cache_creation: msg.tokens.cache.write,
    cache_read: msg.tokens.cache.read,
  };

  let cost = msg.cost ?? 0;
  if (cost === 0) {
    const rates = ctx.modelRates.get(msg.modelID);
    if (rates) cost = calculateCost(tokenDelta, rates);
  }

  const delta: TokenDelta = { ...tokenDelta, cost };

  // Register session and mark message processed synchronously before any async call
  const totals = ctx.tracker.add(sessionId, delta);
  ctx.tracker.markProcessed(msg.id);

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
