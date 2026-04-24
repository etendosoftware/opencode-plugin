import { readFile } from "node:fs/promises";
import type {
  ClaudeSessionRecord,
  ClaudeTranscriptEvent,
  ExtractedMessage,
  ParsedClaudeSession,
} from "./types.js";

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !target.includes(trimmed)) {
      target.push(trimmed);
    }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatToolCallInput(name: string, input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return name;
  }
  const inp = input as Record<string, unknown>;
  if (typeof inp.command === "string") return `${name}: ${inp.command.trim().slice(0, 300)}`;
  if (typeof inp.file_path === "string") return `${name}: ${inp.file_path}`;
  if (typeof inp.path === "string") return `${name}: ${inp.path}`;
  if (typeof inp.description === "string") return `${name}: ${inp.description.slice(0, 150)}`;
  if (typeof inp.prompt === "string") return `${name}: ${inp.prompt.slice(0, 150)}`;
  return `${name}: ${JSON.stringify(input).slice(0, 200)}`;
}

function extractTextFromContent(content: unknown, depth = 0): string[] {
  if (typeof content === "string") {
    return [content.trim()].filter(Boolean);
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      if (item.trim()) parts.push(item.trim());
      continue;
    }

    if (typeof item !== "object" || item === null) {
      continue;
    }

    const rec = item as Record<string, unknown>;
    const type = asString(rec.type);

    if (type === "tool_use") {
      const name = asString(rec.name) ?? "tool";
      const id = asString(rec.id) ?? "";
      parts.push(`⟦TOOL#${id}⟧${formatToolCallInput(name, rec.input)}⟦/TOOL⟧`);
      continue;
    }

    if (type === "tool_result" && depth === 0) {
      const texts = extractTextFromContent(rec.content, 1);
      const combined = texts.join("\n").trim().slice(0, 600);
      const id = asString(rec.tool_use_id) ?? "";
      if (combined) parts.push(`⟦RESULT#${id}⟧${combined}⟦/RESULT⟧`);
      continue;
    }

    const maybeText = asString(rec.text);
    if (maybeText) {
      parts.push(maybeText);
    }
  }

  return parts;
}

function parseSkillListing(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).split(":")[0]?.trim() ?? "")
    .filter(Boolean);
}

const SPANISH_MARKERS = /\b(qué|cómo|cuándo|dónde|por qué|porque|pero|está|están|estás|esto|esta|eso|para|con|los|las|una|uno|también|tambien|entonces|ahora|después|despues|hacia|sobre|entre|cuál|cual|hacer|puedo|puede|puedes|quiero|necesito|podés|pod[eé]s|seguir|seguis|dale|nada|algo|todo|muy|más|mas|menos|si|sí|no|bien|mal|sea|ser|tener|tengo|tiene|tenés|tenes|voy|vas|va|vamos|gracias|hola|ok)\b/gi;
const SPANISH_CHARS = /[áéíóúñü¿¡]/gi;
const ENGLISH_MARKERS = /\b(the|and|but|with|from|that|this|these|those|have|has|was|were|will|would|should|could|what|when|where|why|how|which|there|their|they|them|here|about|again|just|only|also|than|then|still|into|over|under|through|because|before|after|while|yes|thanks|hello)\b/gi;

function stripNonProse(text: string): string {
  return text
    .replace(/<local-command-[^>]+>[\s\S]*?<\/local-command-[^>]+>/g, " ")
    .replace(/<command-[^>]+>[\s\S]*?<\/command-[^>]+>/g, " ")
    .replace(/<[a-z][^>]*>[\s\S]*?<\/[a-z][^>]+>/gi, " ")
    .replace(/\[Request interrupted[^\]]*\]/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, " ")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^[$>#]/.test(trimmed)) return false;
      if (/^\w+@[\w.-]+:/.test(trimmed)) return false;
      if (/^\s*(import|from|def|class|function|const|let|var|return|if|else|for|while)\b/.test(trimmed)) return false;
      return true;
    })
    .join(" ");
}

function detectLanguage(messages: ExtractedMessage[]): "es" | "en" | "mixed" | undefined {
  const shortProseMessages = messages
    .filter((m) => m.role === "user" && !m.isToolOnly && m.text.length < 300)
    .map((m) => m.text);
  if (shortProseMessages.length < 3) return undefined;

  const prose = stripNonProse(shortProseMessages.join(" "));
  if (prose.length < 40) return undefined;

  const spanishHits = (prose.match(SPANISH_MARKERS)?.length ?? 0) + (prose.match(SPANISH_CHARS)?.length ?? 0) * 3;
  const englishHits = prose.match(ENGLISH_MARKERS)?.length ?? 0;
  const total = spanishHits + englishHits;
  if (total < 5) return undefined;

  const spanishRatio = spanishHits / total;
  if (spanishRatio > 0.6) return "es";
  if (spanishRatio < 0.25) return "en";
  return "mixed";
}

const TOOL_MARKER = /⟦TOOL#([^⟧]*)⟧([\s\S]*?)⟦\/TOOL⟧/g;
const RESULT_MARKER = /⟦RESULT#([^⟧]*)⟧([\s\S]*?)⟦\/RESULT⟧/g;

function pairToolsWithResults(messages: ExtractedMessage[]): ExtractedMessage[] {
  const resultsById = new Map<string, string>();
  for (const m of messages) {
    let match: RegExpExecArray | null;
    const re = new RegExp(RESULT_MARKER);
    while ((match = re.exec(m.text)) !== null) {
      if (match[1]) resultsById.set(match[1], match[2].trim());
    }
  }

  const output: ExtractedMessage[] = [];
  for (const m of messages) {
    const transformed = m.text.replace(TOOL_MARKER, (_raw, id: string, payload: string) => {
      const result = resultsById.get(id);
      const call = payload.trim();
      if (result && result.length > 0) {
        return `[ran ${call}]\n→ ${result}`;
      }
      return `[ran ${call}]`;
    });
    const cleaned = transformed.replace(RESULT_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!cleaned) continue;
    output.push({ ...m, text: cleaned });
  }
  return output;
}

function selectKeyUserMessages(messages: ExtractedMessage[]): ExtractedMessage[] {
  const users = messages.filter((m) => m.role === "user" && !m.isToolOnly);
  if (users.length <= 10) {
    return users;
  }

  const selected = [...users.slice(0, 4), ...users.slice(-6)];
  const deduped: ExtractedMessage[] = [];
  const seen = new Set<string>();
  for (const message of selected) {
    const key = `${message.timestamp ?? ""}:${message.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(message);
  }
  return deduped;
}

function toMessage(event: ClaudeTranscriptEvent): ExtractedMessage | null {
  const role = event.type;
  if (role !== "user" && role !== "assistant") {
    return null;
  }

  const message = event.message;
  if (typeof message !== "object" || message === null) {
    return null;
  }

  const content = (message as Record<string, unknown>).content;
  const parts = extractTextFromContent(content);
  const text = parts.join("\n\n").trim();
  if (!text) {
    return null;
  }

  const isToolOnly = Array.isArray(content) && content.every((item) => {
    if (typeof item !== "object" || item === null) return true;
    const t = (item as Record<string, unknown>).type;
    return t === "tool_use" || t === "tool_result";
  });

  return {
    role,
    text,
    timestamp: asString(event.timestamp),
    isToolOnly,
  };
}

export async function parseClaudeTranscript(
  session: ClaudeSessionRecord,
  messageLimit: number,
): Promise<ParsedClaudeSession> {
  const raw = await readFile(session.transcriptPath, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);

  const additionalContext: string[] = [];
  const detectedSkills: string[] = [];
  const detectedMcpServers: string[] = [];
  const messages: ExtractedMessage[] = [];

  let cwd: string | undefined;
  let gitBranch: string | undefined = session.gitBranch;
  let version: string | undefined;
  let firstUserPrompt: string | undefined = session.firstPrompt;
  let lastAssistantMessage: string | undefined;

  for (const line of lines) {
    let event: ClaudeTranscriptEvent;
    try {
      event = JSON.parse(line) as ClaudeTranscriptEvent;
    } catch {
      continue;
    }

    cwd ??= asString(event.cwd);
    gitBranch ??= asString(event.gitBranch);
    version ??= asString(event.version);

    const message = toMessage(event);
    if (message) {
      if (!firstUserPrompt && message.role === "user") {
        firstUserPrompt = message.text;
      }
      if (message.role === "assistant") {
        lastAssistantMessage = message.text;
      }
      messages.push(message);
      continue;
    }

    const attachment = event.attachment;
    if (typeof attachment !== "object" || attachment === null) {
      continue;
    }

    const attachmentRecord = attachment as Record<string, unknown>;
    const attachmentType = asString(attachmentRecord.type);
    if (attachmentType === "hook_additional_context") {
      const content = attachmentRecord.content;
      if (Array.isArray(content)) {
        pushUnique(
          additionalContext,
          content.filter((item): item is string => typeof item === "string"),
        );
      }
    }

    if (attachmentType === "skill_listing") {
      const content = asString(attachmentRecord.content);
      if (content) {
        pushUnique(detectedSkills, parseSkillListing(content));
      }
    }

    if (attachmentType === "mcp_instructions_delta") {
      const addedNames = attachmentRecord.addedNames;
      if (Array.isArray(addedNames)) {
        pushUnique(
          detectedMcpServers,
          addedNames.filter((item): item is string => typeof item === "string"),
        );
      }
    }

    if (attachmentType === "deferred_tools_delta") {
      const addedNames = attachmentRecord.addedNames;
      if (Array.isArray(addedNames)) {
        const toolMcpNames = addedNames
          .filter((item): item is string => typeof item === "string")
          .filter((item) => item.startsWith("mcp__"))
          .map((item) => item.replace(/^mcp__/, "").split("__")[0] ?? item);
        pushUnique(detectedMcpServers, toolMcpNames);
      }
    }
  }

  const pairedMessages = pairToolsWithResults(messages);
  const limit = Math.max(messageLimit, 1);
  const recentMessages = pairedMessages.slice(-limit);
  const olderMessages = pairedMessages.length > limit
    ? pairedMessages.slice(0, pairedMessages.length - limit)
    : [];
  const openingMessages = pairedMessages.slice(0, Math.min(8, pairedMessages.length));
  const keyUserMessages = selectKeyUserMessages(pairedMessages);
  const detectedLanguage = detectLanguage(pairedMessages);

  const lastAssistantFromPaired = [...pairedMessages].reverse().find((m) => m.role === "assistant" && !m.isToolOnly);
  if (lastAssistantFromPaired) {
    lastAssistantMessage = lastAssistantFromPaired.text;
  }

  return {
    session,
    cwd,
    gitBranch,
    version,
    firstUserPrompt,
    lastAssistantMessage,
    totalMessageCount: messages.length,
    openingMessages,
    keyUserMessages,
    additionalContext,
    detectedSkills,
    detectedMcpServers,
    recentMessages,
    olderMessages,
    detectedLanguage,
  };
}
