---
description: Import a specific Claude Code session by session ID into this OpenCode conversation
---
Ask for the Claude session ID if the user did not provide it.

Then use the `resume_claude_session` tool with that ID.

Prefer the tool defaults so that a broad conversation excerpt is imported unless the user explicitly asks for a narrower import.

After the tool returns:

- treat the imported transcript as historical context for this conversation
- do not assume Claude-only MCP servers or permissions are available in OpenCode
- continue helping the user from that imported context
- if the import succeeded, your final response to the user must be exactly the last Claude assistant message returned by the tool
- do not summarize it
- do not paraphrase it
- do not add commentary before or after it unless the tool returned an error instead of a successful import
