---
name: resume-claude-session
description: Import a specific local Claude Code session by session ID into the current OpenCode conversation.
compatibility: opencode
---

Use this when the user wants to resume a concrete Claude Code session and can provide its `sessionId`.

Workflow:

1. Ask for the session ID if missing.
2. Use the `resume_claude_session` tool.
3. Treat the returned text as historical transcript context, not as guaranteed live state.
4. Continue helping the user from that imported context.
5. If the import succeeded, your user-facing reply must be exactly the last Claude assistant message that was imported.
6. Do not summarize, paraphrase, or wrap that message with extra commentary.
