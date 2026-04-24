import type { ExtractedMessage, ParsedClaudeSession } from "./types.js";

function trimBlock(input: string, maxLength = 2600): string {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function renderTurn(message: ExtractedMessage, trimTo: number): string[] {
  const speaker = message.role === "user" ? "You" : "Me";
  return [`${speaker}:`, trimBlock(message.text, trimTo), ""];
}

export type FormatMode = "full" | "metadata-only";

export type FormatOptions = {
  summary?: string;
};

export function formatImportedContext(
  parsed: ParsedClaudeSession,
  mode: FormatMode = "full",
  options: FormatOptions = {},
): string {
  const displayProjectPath = parsed.session.projectPath.startsWith("unknown (")
    ? (parsed.cwd ?? parsed.session.projectPath)
    : parsed.session.projectPath;

  const lines: string[] = [];
  lines.push("# Our prior conversation (imported from Claude)");
  lines.push("");
  if (mode === "metadata-only") {
    lines.push("You and I were already working together in a Claude Code session.");
    lines.push("The actual exchange is replayed as messages in your conversation history above this system block.");
    lines.push("Treat those messages as things you really said to the user — continue naturally from the latest one.");
    lines.push("Do not assume Claude-only tools or MCP servers are available here — re-check before acting.");
  } else {
    lines.push("You and I were already working together in a Claude Code session.");
    lines.push("Below is what we said and did, so you can pick up exactly where we left off.");
    lines.push("Treat it as our shared history, not as a document describing someone else's chat.");
    lines.push("Do not assume Claude-only tools or MCP servers are available here — re-check before acting.");
  }
  if (parsed.detectedLanguage === "es") {
    lines.push("We were conversing in Spanish — continue in Spanish unless the user switches.");
  } else if (parsed.detectedLanguage === "en") {
    lines.push("We were conversing in English — continue in English unless the user switches.");
  }
  lines.push("");

  lines.push("## Context snapshot");
  lines.push(`- Project: ${displayProjectPath}`);
  if (parsed.cwd && parsed.cwd !== displayProjectPath) {
    lines.push(`- Working directory: ${parsed.cwd}`);
  }
  if (parsed.gitBranch) {
    lines.push(`- Git branch: ${parsed.gitBranch}`);
  }
  lines.push(`- Claude session: ${parsed.session.sessionId}`);
  lines.push(`- Total messages exchanged: ${parsed.totalMessageCount}`);
  if (parsed.session.summary) {
    lines.push(`- Session title: ${parsed.session.summary}`);
  }
  lines.push("");

  if (!options.summary && parsed.firstUserPrompt) {
    lines.push("## What you originally asked me");
    lines.push(trimBlock(parsed.firstUserPrompt, 2000));
    lines.push("");
  }

  if (mode === "full") {
    if (options.summary && parsed.olderMessages.length > 0) {
      const summaryBody = options.summary.trim().replace(/^#+[^\n]*\n+/, "");
      lines.push(`## What happened earlier in our conversation (summary of ${parsed.olderMessages.length} prior messages)`);
      lines.push(summaryBody);
      lines.push("");
    } else if (parsed.keyUserMessages.length > 0) {
      lines.push("## Key things you told me along the way");
      for (const message of parsed.keyUserMessages) {
        lines.push(...renderTurn(message, 3000));
      }
    }

    if (!options.summary && parsed.openingMessages.length > 0) {
      lines.push("## How our conversation began");
      for (const message of parsed.openingMessages) {
        lines.push(...renderTurn(message, 2500));
      }
    }

    lines.push("## Where we left off (most recent exchange)");
    if (parsed.recentMessages.length === 0) {
      lines.push("(no textual messages were extracted from the transcript)");
      lines.push("");
    } else {
      for (const message of parsed.recentMessages) {
        lines.push(...renderTurn(message, 3000));
      }
    }

    lines.push("---");
    lines.push("That is where our conversation paused. Continue from here naturally — don't re-introduce yourself, don't re-state the problem, don't summarize what we just did. Just keep going as if no time passed.");
  } else {
    lines.push("---");
    lines.push("Continue from the latest message in the history above — don't re-introduce yourself, don't re-state the problem, don't summarize what we just did. Just keep going as if no time passed.");
  }

  return lines.join("\n").trim();
}
