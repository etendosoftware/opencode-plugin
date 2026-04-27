# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Local OpenCode plugin that bridges Claude Code sessions into OpenCode:

- `resume_claude_last` — import the latest Claude Code session for the current project
- `resume_claude_session` — import a specific Claude session by ID

Target: when the user switches Claude → OpenCode, the new session should feel like a continuation, not a fresh start.

## How the resume flow works

Two pieces work together:

1. **Tool execution (once)** — `resume_claude_*` parses the Claude `.jsonl` transcript from `~/.claude/projects/...`, formats it as a conversational block, and persists it to `<workspace>/.opencode/.claude-bridge-state/<openCodeSessionID>.json`.
2. **Hook (every turn)** — `experimental.chat.system.transform` reads the persisted context from the store and prepends it to the system prompt on every LLM call.

There is also an experimental `experimental.chat.messages.transform` hook gated behind `OPENCODE_CLAUDE_BRIDGE_REPLAY=1`. It injects the recent Claude turns as synthetic Message objects into the conversation history. Off by default because Message/Part invariants are strict and side effects on OpenCode's internal state aren't fully verified.

## Architecture

```
src/
├── index.ts                  # Plugin entry: hooks, tool registration, summarizer wiring
├── claude/
│   ├── sessions.ts           # Locate Claude transcripts (latest / by ID)
│   ├── parse-jsonl.ts        # Parse transcript, extract messages + tool pairs, detect language
│   ├── format-context.ts     # Render parsed session as conversational system block
│   ├── summarize.ts          # LLM summary of older messages via OpenCode SDK client
│   └── types.ts              # Shared types
├── state/
│   ├── context-store.ts      # Disk-backed Map<openCodeSessionID, StoredContext>
│   ├── summary-cache.ts      # On-disk cache keyed by sessionId+mtime+olderCount
│   └── debug-log.ts          # Optional event log (OPENCODE_CLAUDE_BRIDGE_DEBUG=1)
└── telemetry/
    ├── config.ts             # Load telemetry config from .opencode/telemetry.json
    ├── client.ts             # HTTP POST to Fyso backend
    ├── events.ts             # Event processing: onMessageCompleted, onToolUsed, buildPayload
    └── tracker.ts            # Per-session token/cost accumulator (deduplication + delta)
```

Build output lives in `dist/`. `opencode.json` points to `./dist/index.js`.

## Key design choices

- **Conversational framing, not document framing.** The injected block uses "You and I were already working together" rather than "## User / ## Assistant" headers. Models treat it as shared history instead of background reading.
- **Tool calls are visible.** `tool_use` and `tool_result` from the Claude transcript get paired by ID and rendered as `[ran Tool: args] → result`. Previously they were invisible, losing all context about what Claude actually ran.
- **Language continuity.** The parser runs a heuristic on short user messages (stripped of shell output, `<local-command-*>` tags, JWT-like blobs) and emits `es`/`en`/`mixed`. The system block tells the model which language to continue in.
- **Persistence is project-scoped.** State lives under the current workspace's `.opencode/`, not a global dir. Entries older than 30 days are pruned on plugin init.
- **LLM summary for older messages.** Messages beyond the last 40 are summarized using the active OpenCode model (`client.session.create/prompt/delete`). Result cached in `.opencode/.claude-bridge-cache/<sessionId>-<mtime>-<olderCount>.md` — regenerated only when the transcript changes. Disable with `OPENCODE_CLAUDE_BRIDGE_SUMMARY=0`.

### Telemetry

Configured via `.opencode/telemetry.json` in the workspace root. When present, the plugin emits `opencode_session_start` and `opencode_turn` events to the Fyso backend on each completed assistant message, plus `opencode_tool_use` when a resume tool runs.

Three non-obvious invariants in `events.ts`:

- **`message.updated` fires multiple times per turn** — during streaming (tokens=0) and again after completion. Only process when `msg.time?.completed` is set; ignore the rest.
- **`msg.tokens` and `msg.cost` are cumulative session totals**, not per-turn values. Subtract the previous session totals (from `SessionTracker`) to get the actual delta for that turn.
- **`system.transform` fires before every turn** and passes `input.model.cost`. For models OpenCode doesn't price (e.g. OpenAI via proxy), it passes `{input:0, output:0}`. Only overwrite stored rates when the incoming values are non-zero, otherwise you clobber the rates loaded from `provider.list()` at startup.

## Development

```bash
npm install
npm run build          # Compile TypeScript → dist/
```

Testing changes requires rebuilding and restarting OpenCode — plugins are loaded once at startup, not hot-reloaded.

To verify the parser manually against a real transcript:

```bash
node --input-type=module <<'EOF'
import { parseClaudeTranscript } from "./dist/claude/parse-jsonl.js";
import { formatImportedContext } from "./dist/claude/format-context.js";
const session = {
  sessionId: "<uuid>",
  transcriptPath: "/home/.../<uuid>.jsonl",
  projectPath: "/home/.../project",
  projectKey: "<slashed-path>",
};
const parsed = await parseClaudeTranscript(session, 40);
console.log(formatImportedContext(parsed));
EOF
```

## Releasing a new version

The plugin is published to npm as `opencode-claude-bridge-plugin`. OpenCode downloads it automatically from the registry — users don't run `npm install`.

1. Build and verify tests pass:
   ```bash
   npm run build
   npm test
   ```
2. Bump version (choose `patch` / `minor` / `major`):
   ```bash
   npm version patch --no-git-tag-version
   ```
3. Publish to npm (requires auth token in `~/.npmrc`):
   ```bash
   npm publish --access public
   ```
4. Commit and push:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore: bump to vX.Y.Z"
   git push
   ```

**npm auth:** publishing requires a granular token with read+write access and "bypass 2FA" enabled. Set it with:
```bash
npm config set //registry.npmjs.org/:_authToken <token>
```
Passing via `NPM_TOKEN` env var doesn't work reliably — use `.npmrc`.

Use `patch` for bug fixes, `minor` for new features or behavior changes, `major` for breaking changes to the plugin API or config format.

## Things to avoid

- **Do not widen the message limit blindly.** 40 messages with tool pairs already lands around 7K tokens. Adding more without a summarization step will blow prompt caches and cost.
- **Do not fabricate Message/Part objects outside `buildSyntheticMessages`.** That helper exists specifically to mirror a real message's `agent`, `model`, `path`, `mode` fields. Hand-rolled objects risk breaking the provider adapter silently.
- **Do not re-introduce the `additionalContext` dump.** It was ~8K chars of CLAUDE.md/skill metadata with zero continuity value — removed deliberately.
- **Do not persist transcripts or fabricated messages to OpenCode's session DB.** The store writes to its own JSON files in `.opencode/.claude-bridge-state/` and nothing else.

## What's not done yet

- Live sync when the Claude `.jsonl` grows during an active OpenCode session.
- Auto-import trigger on first message in a fresh session.
- Semantic retrieval over all messages instead of last-N truncation.
