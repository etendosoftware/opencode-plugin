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
├── index.ts                  # Plugin entry: hooks, tool registration
├── claude/
│   ├── sessions.ts           # Locate Claude transcripts (latest / by ID)
│   ├── parse-jsonl.ts        # Parse transcript, extract messages + tool pairs, detect language
│   ├── format-context.ts     # Render parsed session as conversational system block
│   └── types.ts              # Shared types
└── state/
    └── context-store.ts      # Disk-backed Map<openCodeSessionID, StoredContext>
```

Build output lives in `dist/`. `opencode.json` points to `./dist/index.js`.

## Key design choices

- **Conversational framing, not document framing.** The injected block uses "You and I were already working together" rather than "## User / ## Assistant" headers. Models treat it as shared history instead of background reading.
- **Tool calls are visible.** `tool_use` and `tool_result` from the Claude transcript get paired by ID and rendered as `[ran Tool: args] → result`. Previously they were invisible, losing all context about what Claude actually ran.
- **Language continuity.** The parser runs a heuristic on short user messages (stripped of shell output, `<local-command-*>` tags, JWT-like blobs) and emits `es`/`en`/`mixed`. The system block tells the model which language to continue in.
- **Persistence is project-scoped.** State lives under the current workspace's `.opencode/`, not a global dir. Entries older than 30 days are pruned on plugin init.

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

## Things to avoid

- **Do not widen the message limit blindly.** 40 messages with tool pairs already lands around 7K tokens. Adding more without a summarization step will blow prompt caches and cost.
- **Do not fabricate Message/Part objects outside `buildSyntheticMessages`.** That helper exists specifically to mirror a real message's `agent`, `model`, `path`, `mode` fields. Hand-rolled objects risk breaking the provider adapter silently.
- **Do not re-introduce the `additionalContext` dump.** It was ~8K chars of CLAUDE.md/skill metadata with zero continuity value — removed deliberately.
- **Do not persist transcripts or fabricated messages to OpenCode's session DB.** The store writes to its own JSON files in `.opencode/.claude-bridge-state/` and nothing else.

## What's not done yet

- LLM-generated structured summary (currently the transcript is truncated, not summarized).
- Live sync when the Claude `.jsonl` grows during an active OpenCode session.
- Auto-import trigger on first message in a fresh session.
- Semantic retrieval over all messages instead of last-N truncation.
