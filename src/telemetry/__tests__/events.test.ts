import { vi, describe, it, expect, beforeEach } from "vitest";
import { modelFamily, buildPayload, onMessageCompleted, onToolUsed, createTelemetryContext, setModelRates } from "../events.js";
import { ZERO_TOTALS } from "../tracker.js";
import type { TelemetryConfig } from "../config.js";
import type { TokenDelta } from "../tracker.js";

vi.mock("../client.js", () => ({
  sendEvent: vi.fn().mockResolvedValue(undefined),
}));

import { sendEvent } from "../client.js";

const mockConfig: TelemetryConfig = {
  token: "tok",
  tenant_id: "tenant-1",
  api_url: "https://api.fyso.dev",
  user: "user@example.com",
  team_name: "my-team",
  cwd: "/home/user/project",
};

function makeAssistantEvent(sessionID: string, modelID: string, tokens = { input: 100, output: 50, reasoning: 0, cache: { read: 5, write: 10 } }, cost = 0.002, id = "msg-1") {
  return {
    type: "message.updated" as const,
    properties: {
      sessionID,
      info: {
        role: "assistant" as const,
        sessionID,
        modelID,
        id,
        parentID: "msg-0",
        providerID: "anthropic",
        mode: "build",
        path: { cwd: "/", root: "/" },
        time: { created: Date.now() - 500, completed: Date.now() },
        summary: false,
        cost,
        tokens,
        finish: "stop",
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("modelFamily", () => {
  it("detects opus", () => expect(modelFamily("claude-opus-4-7")).toBe("opus"));
  it("detects sonnet", () => expect(modelFamily("claude-sonnet-4-6")).toBe("sonnet"));
  it("detects haiku", () => expect(modelFamily("claude-haiku-4-5-20251001")).toBe("haiku"));
  it("returns null for non-claude model", () => expect(modelFamily("gpt-4o")).toBeNull());
  it("returns null for empty string", () => expect(modelFamily("")).toBeNull());
});

describe("buildPayload", () => {
  const delta: TokenDelta = { input: 100, output: 50, cache_creation: 10, cache_read: 5, cost: 0.002 };

  it("sets source and opencode flag", () => {
    const p = buildPayload("opencode_turn", "sess-1", "claude-sonnet-4-6", delta, ZERO_TOTALS, null, mockConfig);
    expect(p.source).toBe("opencode");
    expect(p.opencode).toBe(true);
  });

  it("computes total tokens as sum of delta parts", () => {
    const p = buildPayload("opencode_turn", "sess-1", "claude-sonnet-4-6", delta, ZERO_TOTALS, null, mockConfig);
    expect(p.tokens).toBe(165); // 100+50+10+5
    expect(p.input_tokens).toBe(100);
    expect(p.output_tokens).toBe(50);
    expect(p.cache_creation_tokens).toBe(10);
    expect(p.cache_read_tokens).toBe(5);
  });

  it("includes model_family derived from modelId", () => {
    const p = buildPayload("opencode_turn", "sess-1", "claude-sonnet-4-6", delta, ZERO_TOTALS, null, mockConfig);
    expect(p.model).toBe("claude-sonnet-4-6");
    expect(p.model_family).toBe("sonnet");
  });

  it("propagates config fields into payload", () => {
    const p = buildPayload("opencode_turn", "sess-1", "claude-sonnet-4-6", delta, ZERO_TOTALS, null, mockConfig);
    expect(p.user).toBe("user@example.com");
    expect(p.team_name).toBe("my-team");
    expect(p.cwd).toBe("/home/user/project");
  });

  it("includes session totals from tracker", () => {
    const totals = { tokens: 500, input_tokens: 250, output_tokens: 200, cache_creation_tokens: 30, cache_read_tokens: 20, cost_usd: 0.01 };
    const p = buildPayload("opencode_turn", "sess-1", "claude-sonnet-4-6", delta, totals, null, mockConfig);
    expect(p.session_tokens).toBe(500);
    expect(p.session_input_tokens).toBe(250);
  });

  it("includes detail when provided", () => {
    const p = buildPayload("opencode_tool_use", "sess-1", "", delta, ZERO_TOTALS, "imported 40 messages", mockConfig);
    expect(p.detail).toBe("imported 40 messages");
  });
});

describe("onMessageCompleted", () => {
  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
  });

  it("fires session_start then turn on first message for a new session", async () => {
    const ctx = createTelemetryContext(mockConfig);
    await onMessageCompleted(makeAssistantEvent("sess-new", "claude-sonnet-4-6"), ctx);

    expect(vi.mocked(sendEvent)).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = vi.mocked(sendEvent).mock.calls;
    expect(firstCall[0].event).toBe("opencode_session_start");
    expect(firstCall[0].tokens).toBe(0);
    expect(secondCall[0].event).toBe("opencode_turn");
    expect(secondCall[0].tokens).toBe(165); // 100+50+10+5
  });

  it("fires only turn (no session_start) on subsequent messages for the same session", async () => {
    const ctx = createTelemetryContext(mockConfig);
    await onMessageCompleted(makeAssistantEvent("sess-existing", "claude-sonnet-4-6"), ctx);
    vi.mocked(sendEvent).mockClear();

    await onMessageCompleted(makeAssistantEvent("sess-existing", "claude-sonnet-4-6", undefined, undefined, "msg-2"), ctx);
    expect(vi.mocked(sendEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEvent).mock.calls[0][0].event).toBe("opencode_turn");
  });

  it("reports per-turn delta tokens when msg.tokens is cumulative", async () => {
    const ctx = createTelemetryContext(mockConfig);
    // Turn 1: cumulative = 100 input, 50 output
    await onMessageCompleted(makeAssistantEvent("sess-delta", "claude-sonnet-4-6", { input: 100, output: 50, reasoning: 0, cache: { read: 5, write: 10 } }, 0.002, "msg-t1"), ctx);
    vi.mocked(sendEvent).mockClear();

    // Turn 2: cumulative = 110 input, 70 output (delta = 10 input, 20 output)
    await onMessageCompleted(makeAssistantEvent("sess-delta", "claude-sonnet-4-6", { input: 110, output: 70, reasoning: 0, cache: { read: 5, write: 10 } }, 0.003, "msg-t2"), ctx);
    const turnCall = vi.mocked(sendEvent).mock.calls[0][0];
    expect(turnCall.input_tokens).toBe(10);
    expect(turnCall.output_tokens).toBe(20);
    expect(turnCall.tokens).toBe(30); // only the delta, not 110+70
  });

  it("skips user messages (non-assistant role)", async () => {
    const ctx = createTelemetryContext(mockConfig);
    const userEvent = {
      type: "message.updated" as const,
      properties: { sessionID: "sess-1", info: { role: "user" } },
    } as any;
    await onMessageCompleted(userEvent, ctx);
    expect(vi.mocked(sendEvent)).not.toHaveBeenCalled();
  });

  it("skips non-message events (e.g. session.status)", async () => {
    const ctx = createTelemetryContext(mockConfig);
    await onMessageCompleted({ type: "session.status", properties: { sessionID: "s", status: { type: "idle" } } }, ctx);
    expect(vi.mocked(sendEvent)).not.toHaveBeenCalled();
  });

  it("deduplicates: same message ID processed twice fires events only once", async () => {
    const ctx = createTelemetryContext(mockConfig);
    const event = makeAssistantEvent("sess-dedup", "claude-sonnet-4-6");
    await onMessageCompleted(event, ctx);
    vi.mocked(sendEvent).mockClear();

    await onMessageCompleted(event, ctx);
    expect(vi.mocked(sendEvent)).not.toHaveBeenCalled();
  });

  it("uses fallback cost calculation when msg.cost is 0 and model rates are set", async () => {
    const ctx = createTelemetryContext(mockConfig);
    setModelRates(ctx, "gpt-5.4", { input: 10, output: 30, cache_read: 1, cache_write: 5 });
    // tokens: input=100, output=50, cache.write=10, cache.read=5, cost=0 (OpenAI model)
    const event = makeAssistantEvent("sess-cost", "gpt-5.4", { input: 100, output: 50, reasoning: 0, cache: { read: 5, write: 10 } }, 0);
    await onMessageCompleted(event, ctx);

    const turnCall = vi.mocked(sendEvent).mock.calls.find(c => c[0].event === "opencode_turn");
    expect(turnCall).toBeDefined();
    // cost = (100/1M)*10 + (50/1M)*30 + (10/1M)*5 + (5/1M)*1 = 0.001 + 0.0015 + 0.00005 + 0.000005 = 0.002555
    expect(turnCall![0].cost_usd).toBeCloseTo(0.002555, 6);
  });

  it("keeps cost_usd as 0 when msg.cost is 0 and no model rates are available", async () => {
    const ctx = createTelemetryContext(mockConfig);
    const event = makeAssistantEvent("sess-no-rates", "gpt-unknown", { input: 100, output: 50, reasoning: 0, cache: { read: 5, write: 10 } }, 0);
    await onMessageCompleted(event, ctx);

    const turnCall = vi.mocked(sendEvent).mock.calls.find(c => c[0].event === "opencode_turn");
    expect(turnCall![0].cost_usd).toBe(0);
  });
});

describe("onToolUsed", () => {
  beforeEach(() => {
    vi.mocked(sendEvent).mockClear();
  });

  it("fires opencode_tool_use with detail", async () => {
    const ctx = createTelemetryContext(mockConfig);
    await onToolUsed("sess-1", "imported 40 messages from session abc123", ctx);

    expect(vi.mocked(sendEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEvent).mock.calls[0][0].event).toBe("opencode_tool_use");
    expect(vi.mocked(sendEvent).mock.calls[0][0].detail).toBe("imported 40 messages from session abc123");
  });

  it("includes session totals if session was already tracked", async () => {
    const ctx = createTelemetryContext(mockConfig);
    await onMessageCompleted(makeAssistantEvent("sess-tracked", "claude-sonnet-4-6"), ctx);
    vi.mocked(sendEvent).mockClear();

    await onToolUsed("sess-tracked", "imported session", ctx);
    const payload = vi.mocked(sendEvent).mock.calls[0][0];
    expect(payload.session_tokens).toBeGreaterThan(0);
  });
});
