import { describe, it, expect } from "vitest";
import { SessionTracker } from "../tracker.js";

describe("SessionTracker", () => {
  it("reports unknown sessions as new", () => {
    const tracker = new SessionTracker();
    expect(tracker.isNew("sess-1")).toBe(true);
  });

  it("reports known sessions as not new after first add", () => {
    const tracker = new SessionTracker();
    tracker.add("sess-1", { input: 100, output: 50, cache_creation: 0, cache_read: 0, cost: 0.001 });
    expect(tracker.isNew("sess-1")).toBe(false);
  });

  it("accumulates tokens correctly across two turns", () => {
    const tracker = new SessionTracker();
    tracker.add("sess-1", { input: 100, output: 50, cache_creation: 10, cache_read: 5, cost: 0.001 });
    const totals = tracker.add("sess-1", { input: 200, output: 100, cache_creation: 0, cache_read: 20, cost: 0.002 });
    expect(totals.input_tokens).toBe(300);
    expect(totals.output_tokens).toBe(150);
    expect(totals.cache_creation_tokens).toBe(10);
    expect(totals.cache_read_tokens).toBe(25);
    expect(totals.tokens).toBe(485); // 300+150+10+25
    expect(totals.cost_usd).toBeCloseTo(0.003);
  });

  it("keeps separate totals per session", () => {
    const tracker = new SessionTracker();
    tracker.add("sess-1", { input: 100, output: 50, cache_creation: 0, cache_read: 0, cost: 0 });
    tracker.add("sess-2", { input: 200, output: 100, cache_creation: 0, cache_read: 0, cost: 0 });
    expect(tracker.get("sess-1")?.input_tokens).toBe(100);
    expect(tracker.get("sess-2")?.input_tokens).toBe(200);
  });

  it("returns undefined for sessions that were never added", () => {
    const tracker = new SessionTracker();
    expect(tracker.get("unknown")).toBeUndefined();
  });
});
