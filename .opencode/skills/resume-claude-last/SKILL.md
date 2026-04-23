---
name: resume-claude-last
description: Import the latest local Claude Code session for the current project into the current OpenCode conversation.
compatibility: opencode
---

Use this when the user wants to continue from the last Claude Code conversation for the current project.

Workflow:

1. Use the `resume_claude_last` tool.
2. Treat the returned text as historical transcript context, not as guaranteed live state.
3. Call out any Claude-only MCP servers, skills, or assumptions that may not exist in OpenCode.
4. Continue helping the user from that imported context.
5. If the import succeeded, your user-facing reply must be exactly the last Claude assistant message that was imported.
6. Do not summarize, paraphrase, or wrap that message with extra commentary.
