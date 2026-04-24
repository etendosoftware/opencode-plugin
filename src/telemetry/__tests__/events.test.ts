import { describe, it, expect } from "vitest";
import { modelFamily, buildPayload } from "../events.js";
import { ZERO_TOTALS } from "../tracker.js";
import type { TelemetryConfig } from "../config.js";
import type { TokenDelta } from "../tracker.js";

const mockConfig: TelemetryConfig = {
  token: "tok",
  tenant_id: "tenant-1",
  api_url: "https://api.fyso.dev",
  user: "user@example.com",
  team_name: "my-team",
  cwd: "/home/user/project",
};

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
