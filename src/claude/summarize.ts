import type { PluginInput } from "@opencode-ai/plugin";
import type { ExtractedMessage, ParsedClaudeSession } from "./types.js";

type OpenCodeClient = PluginInput["client"];

const MAX_INPUT_CHARS = 60_000;
const MAX_PER_MESSAGE = 1_500;

function renderMessagesForSummary(messages: ExtractedMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const speaker = m.role === "user" ? "User" : "Assistant";
    const text = m.text.length > MAX_PER_MESSAGE
      ? `${m.text.slice(0, MAX_PER_MESSAGE - 3)}...`
      : m.text;
    lines.push(`${speaker}: ${text}`);
  }
  let joined = lines.join("\n\n");
  if (joined.length > MAX_INPUT_CHARS) {
    joined = `[...earlier turns truncated...]\n\n${joined.slice(-MAX_INPUT_CHARS)}`;
  }
  return joined;
}

function buildSummaryPrompt(parsed: ParsedClaudeSession, olderCount: number, recentCount: number): string {
  const transcript = renderMessagesForSummary(parsed.olderMessages);
  const languageHint = parsed.detectedLanguage === "es"
    ? "Write the summary in Spanish."
    : "Write the summary in English.";

  return [
    `The following is the EARLIER PORTION (${olderCount} messages) of a coding conversation between a user and an AI assistant.`,
    `After these messages, the most recent ${recentCount} messages will be shown verbatim to continue the conversation — you do NOT need to summarize those, only what came before.`,
    "",
    "Produce a concise structured summary so the assistant can resume without losing what happened earlier.",
    "",
    "Include:",
    "- Objective: what the user was ultimately trying to accomplish",
    "- Key decisions: non-obvious choices made, with brief rationale",
    "- Files/areas touched: paths or modules that were modified or discussed",
    "- Current state: what was done, what was working, what was pending when this earlier section ended",
    "- Open threads: questions that were raised but not resolved, or TODOs still hanging",
    "",
    "Be factual. Do not invent details. If something was not discussed, omit it. Keep under 600 words.",
    languageHint,
    "",
    "--- EARLIER CONVERSATION ---",
    transcript,
    "--- END EARLIER CONVERSATION ---",
  ].join("\n");
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      chunks.push(p.text);
    }
  }
  return chunks.join("\n").trim();
}

export type SummarizeDeps = {
  client: OpenCodeClient;
  directory?: string;
  onError?: (err: unknown, phase: string) => void;
};

export async function summarizeOlderMessages(
  parsed: ParsedClaudeSession,
  deps: SummarizeDeps,
): Promise<string | undefined> {
  if (parsed.olderMessages.length === 0) return undefined;

  const { client, directory, onError } = deps;
  let tempSessionId: string | undefined;

  try {
    const created = await client.session.create({
      body: { title: "[claude-bridge] summarize" },
      query: directory ? { directory } : undefined,
      throwOnError: true,
    });
    const session = (created as { data?: { id?: string } }).data;
    tempSessionId = session?.id;
    if (!tempSessionId) return undefined;

    const prompt = buildSummaryPrompt(parsed, parsed.olderMessages.length, parsed.recentMessages.length);

    const reply = await client.session.prompt({
      body: {
        system: "You summarize prior coding conversations so another AI assistant can continue them without losing context. Output only the summary — no preamble, no meta commentary.",
        parts: [{ type: "text", text: prompt }],
      },
      path: { id: tempSessionId },
      query: directory ? { directory } : undefined,
      throwOnError: true,
    });

    const replyData = (reply as { data?: { parts?: unknown } }).data;
    const text = extractText(replyData?.parts);
    return text.length > 0 ? text : undefined;
  } catch (err) {
    onError?.(err, "summarize");
    return undefined;
  } finally {
    if (tempSessionId) {
      try {
        await client.session.delete({
          path: { id: tempSessionId },
          query: directory ? { directory } : undefined,
          throwOnError: true,
        });
      } catch (err) {
        onError?.(err, "delete-temp-session");
      }
    }
  }
}
