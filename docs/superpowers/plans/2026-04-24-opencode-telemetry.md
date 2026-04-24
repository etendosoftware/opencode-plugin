# OpenCode Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `src/telemetry/` module to the opencode-plugin that sends per-turn usage data to the Fyso API (`/api/entities/tracking/records`) using the same credentials and endpoint as fyso-team-sync.

**Architecture:** A new `src/telemetry/` module with four focused files (config, client, tracker, events) is wired into `index.ts` via OpenCode's `event` hook. The hook fires on every `EventMessageUpdated`, which carries token counts and cost from the completed LLM response. Session totals accumulate in memory. All errors are swallowed — telemetry never breaks the plugin.

**Tech Stack:** TypeScript (NodeNext ESM), `@opencode-ai/plugin` SDK for the `Event` type and hook registration, native `fetch` for HTTP, vitest for unit tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/telemetry/config.ts` | Read `~/.fyso/config.json` and `.fyso/team.json`; return `TelemetryConfig \| null` |
| Create | `src/telemetry/tracker.ts` | In-memory `SessionTracker` that accumulates per-session token totals |
| Create | `src/telemetry/client.ts` | Define `TelemetryPayload` type; `sendEvent()` fire-and-forget HTTP POST |
| Create | `src/telemetry/events.ts` | `TelemetryContext`, `modelFamily()`, `buildPayload()`, `onMessageCompleted()`, `onToolUsed()` |
| Create | `src/telemetry/__tests__/tracker.test.ts` | Unit tests for SessionTracker |
| Create | `src/telemetry/__tests__/events.test.ts` | Unit tests for modelFamily and buildPayload |
| Create | `vitest.config.ts` | Vitest configuration |
| Modify | `package.json` | Add vitest devDependency and test script |
| Modify | `tsconfig.json` | Exclude test files from tsc build |
| Modify | `src/index.ts` | Register `event` hook, call `onToolUsed` from both tools |

---

## Task 1: Test infrastructure

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

Expected output: vitest appears in `package.json` devDependencies.

- [ ] **Step 2: Add test script to `package.json`**

In the `"scripts"` section, add `"test": "vitest run"`:

```json
{
  "name": "opencode-claude-bridge",
  "version": "0.2.0",
  "description": "OpenCode plugin to resume Claude Code sessions inside OpenCode without losing context.",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepare": "npm run build",
    "test": "vitest run"
  },
  "keywords": ["opencode", "plugin", "claude", "claude-code", "resume"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/etendosoftware/opencode-plugin.git"
  },
  "bugs": {
    "url": "https://github.com/etendosoftware/opencode-plugin/issues"
  },
  "homepage": "https://github.com/etendosoftware/opencode-plugin#readme",
  "license": "MIT",
  "author": "Etendo Software",
  "dependencies": {
    "@opencode-ai/plugin": "1.4.7"
  },
  "devDependencies": {
    "@types/node": "22.13.9",
    "typescript": "5.8.2",
    "vitest": "<version installed by npm>"
  }
}
```

(Keep the actual vitest version that npm installed — don't change it.)

- [ ] **Step 3: Exclude test files from tsc**

In `tsconfig.json`, add an `"exclude"` array so that `npm run build` doesn't try to compile test files:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "node_modules"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Verify vitest runs (no tests yet)**

```bash
npm test
```

Expected output: `No test files found` or `0 tests passed`. No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 2: `src/telemetry/config.ts`

**Files:**
- Create: `src/telemetry/config.ts`

No TDD for this file — the logic is simple file I/O with no branching worth isolating in a unit test. Integration is verified in Task 6.

- [ ] **Step 1: Create `src/telemetry/config.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/telemetry/config.ts
git commit -m "feat(telemetry): add config loader for ~/.fyso/config.json"
```

---

## Task 3: `src/telemetry/tracker.ts` (TDD)

**Files:**
- Create: `src/telemetry/tracker.ts`
- Create: `src/telemetry/__tests__/tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/telemetry/__tests__/tracker.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: `Cannot find module '../tracker.js'` or similar import error.

- [ ] **Step 3: Create `src/telemetry/tracker.ts`**

```typescript
export type TokenDelta = {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  cost: number;
};

export type SessionTotals = {
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
};

const ZERO_TOTALS: SessionTotals = {
  tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  cost_usd: 0,
};

export class SessionTracker {
  private sessions = new Map<string, SessionTotals>();

  isNew(sessionId: string): boolean {
    return !this.sessions.has(sessionId);
  }

  add(sessionId: string, delta: TokenDelta): SessionTotals {
    const prev = this.sessions.get(sessionId) ?? { ...ZERO_TOTALS };
    const next: SessionTotals = {
      input_tokens: prev.input_tokens + delta.input,
      output_tokens: prev.output_tokens + delta.output,
      cache_creation_tokens: prev.cache_creation_tokens + delta.cache_creation,
      cache_read_tokens: prev.cache_read_tokens + delta.cache_read,
      tokens: prev.tokens + delta.input + delta.output + delta.cache_creation + delta.cache_read,
      cost_usd: prev.cost_usd + delta.cost,
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  get(sessionId: string): SessionTotals | undefined {
    return this.sessions.get(sessionId);
  }
}

export { ZERO_TOTALS };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: `5 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/tracker.ts src/telemetry/__tests__/tracker.test.ts
git commit -m "feat(telemetry): add SessionTracker with tests"
```

---

## Task 4: `src/telemetry/client.ts`

**Files:**
- Create: `src/telemetry/client.ts`

No unit test — `sendEvent` makes a real HTTP call. Integration is verified manually in Task 7.

- [ ] **Step 1: Create `src/telemetry/client.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/telemetry/client.ts
git commit -m "feat(telemetry): add Fyso API client"
```

---

## Task 5: `src/telemetry/events.ts` (TDD)

**Files:**
- Create: `src/telemetry/events.ts`
- Create: `src/telemetry/__tests__/events.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/telemetry/__tests__/events.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: `Cannot find module '../events.js'`.

- [ ] **Step 3: Create `src/telemetry/events.ts`**

```typescript
import type { Event } from "@opencode-ai/plugin";
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
  event: Event,
  ctx: TelemetryContext,
): Promise<void> {
  if (event.type !== "message.updated") return;
  const msg = event.properties.info;
  if (msg.role !== "assistant") return;

  const sessionId = msg.sessionID;
  const isNew = ctx.tracker.isNew(sessionId);

  if (isNew) {
    await sendEvent(
      buildPayload("opencode_session_start", sessionId, msg.modelID, ZERO_DELTA, { ...ZERO_TOTALS }, null, ctx.config),
      ctx.config,
    );
  }

  const delta: TokenDelta = {
    input: msg.tokens.input,
    output: msg.tokens.output,
    cache_creation: msg.tokens.cache.write,
    cache_read: msg.tokens.cache.read,
    cost: msg.cost ?? 0,
  };

  const totals = ctx.tracker.add(sessionId, delta);

  await sendEvent(
    buildPayload("opencode_turn", sessionId, msg.modelID, delta, totals, null, ctx.config),
    ctx.config,
  );
}

export async function onToolUsed(
  toolName: string,
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: `11 tests passed` (5 tracker + 6 events).

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/events.ts src/telemetry/__tests__/events.test.ts
git commit -m "feat(telemetry): add event handlers with tests"
```

---

## Task 6: Integrate into `src/index.ts`

**Files:**
- Modify: `src/index.ts`

The integration has three parts: (a) load config at plugin init, (b) register `event` hook, (c) call `onToolUsed` from each tool.

- [ ] **Step 1: Add telemetry imports at the top of `src/index.ts`**

After the existing imports (after line 13), add:

```typescript
import type { Event } from "@opencode-ai/plugin";
import { loadTelemetryConfig } from "./telemetry/config.js";
import { createTelemetryContext, onMessageCompleted, onToolUsed } from "./telemetry/events.js";
import type { TelemetryContext } from "./telemetry/events.js";
```

- [ ] **Step 2: Initialize telemetry context after `debug.log("plugin.init", ...)` in `src/index.ts`**

Find the line:
```typescript
debug.log("plugin.init", { workspaceRoot, replayMessages, summaryDisabled });
```

Add immediately after it:
```typescript
  const telemetryConfig = await loadTelemetryConfig(workspaceRoot);
  const telemetryCtx: TelemetryContext | null = telemetryConfig
    ? createTelemetryContext(telemetryConfig)
    : null;
```

- [ ] **Step 3: Register the `event` hook in the returned object**

Find the closing `return {` block that starts at line 151. Add the `event` hook as the first entry in the returned object, before `"experimental.chat.system.transform"`:

```typescript
  return {
    event: async (input: { event: Event }) => {
      if (!telemetryCtx) return;
      await onMessageCompleted(input.event, telemetryCtx);
    },

    "experimental.chat.system.transform": async (input, output) => {
      // ... existing code unchanged ...
    },
    // ... rest unchanged ...
  };
```

- [ ] **Step 4: Call `onToolUsed` in `resume_claude_last`**

Find the line in `resume_claude_last` that calls `context.metadata(...)`. Add after it (before the `return renderImportResult(...)` call):

```typescript
          if (telemetryCtx) {
            await onToolUsed(
              "resume_claude_last",
              context.sessionID,
              `imported ${parsed.recentMessages.length} of ${parsed.totalMessageCount} messages from session ${session.sessionId.slice(0, 8)}`,
              telemetryCtx,
            );
          }
```

- [ ] **Step 5: Call `onToolUsed` in `resume_claude_session`**

Find the equivalent `context.metadata(...)` call in `resume_claude_session`. Add after it (before the `return renderImportResult(...)` call):

```typescript
          if (telemetryCtx) {
            await onToolUsed(
              "resume_claude_session",
              context.sessionID,
              `imported ${parsed.recentMessages.length} of ${parsed.totalMessageCount} messages from session ${session.sessionId.slice(0, 8)}`,
              telemetryCtx,
            );
          }
```

- [ ] **Step 6: Run all tests to confirm nothing broke**

```bash
npm test
```

Expected: `11 tests passed`.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(telemetry): wire event hook and tool tracking into index.ts"
```

---

## Task 7: Build and verify

**Files:** none — verification only.

- [ ] **Step 1: Build the plugin**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/` updated.

- [ ] **Step 2: Verify the build output includes telemetry files**

```bash
ls dist/telemetry/
```

Expected: `config.js  client.js  tracker.js  events.js` (and their `.d.ts` files).

- [ ] **Step 3: Smoke-test with a real OpenCode session**

Restart OpenCode (plugins are loaded once at startup). Open any project. Send one message. Then check if a record appeared in Fyso's tracking entity. If `~/.fyso/config.json` is present, data should have been sent.

To verify without Fyso access, temporarily add a `console.error` inside `sendEvent`'s `catch` block, rebuild, and check OpenCode's logs.

- [ ] **Step 4: Commit version bump**

Update version in `package.json` to `0.3.0`:

```bash
npm version minor --no-git-tag-version
git add package.json package-lock.json
git commit -m "v0.3.0: add Fyso telemetry (opencode_turn, opencode_session_start, opencode_tool_use)"
```

- [ ] **Step 5: Tag and push**

```bash
git tag v0.3.0
git push git@github-facu:etendosoftware/opencode-plugin.git main --tags
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ `src/telemetry/config.ts` — reads `~/.fyso/config.json` + `.fyso/team.json`, returns null when missing/disabled
- ✅ `src/telemetry/client.ts` — `TelemetryPayload` type + fire-and-forget `sendEvent` with 5s timeout
- ✅ `src/telemetry/tracker.ts` — `SessionTracker` accumulates per-session totals in memory
- ✅ `src/telemetry/events.ts` — `onMessageCompleted` fires `session_start` on first turn + `turn` on every turn; `onToolUsed` fires `tool_use`
- ✅ `src/index.ts` integration — `event` hook registered, both tools call `onToolUsed`
- ✅ `OPENCODE_FYSO_TELEMETRY=0` disables telemetry
- ✅ All errors swallowed
- ✅ Token fields: `input`, `output`, `cache_creation`, `cache_read`, all session totals
- ✅ `cost_usd` from `AssistantMessage.cost` (SDK-calculated, works for all providers)
- ✅ `opencode: true` flag, `source: "opencode"`, no `claude_account`

**Type consistency check:**
- `TokenDelta` (tracker.ts) used in `buildPayload` (events.ts) — matches
- `SessionTotals` (tracker.ts) returned by `tracker.add()` and `tracker.get()` — used in `buildPayload` — matches
- `TelemetryConfig` (config.ts) used in `createTelemetryContext` and `buildPayload` — matches
- `TelemetryPayload` (client.ts) returned by `buildPayload` and consumed by `sendEvent` — matches
- `ZERO_TOTALS` exported from `tracker.ts` and imported in both `events.ts` and `events.test.ts` — matches
