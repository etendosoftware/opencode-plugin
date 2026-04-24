import path from "node:path";
import { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import { stat } from "node:fs/promises";
import { formatImportedContext } from "./claude/format-context.js";
import { parseClaudeTranscript } from "./claude/parse-jsonl.js";
import { resolveLatestSession, resolveSessionById } from "./claude/sessions.js";
import { summarizeOlderMessages } from "./claude/summarize.js";
import { createContextStore } from "./state/context-store.js";
import { createDebugLogger } from "./state/debug-log.js";
import { createSummaryCache } from "./state/summary-cache.js";
import type { ExtractedMessage, ParsedClaudeSession } from "./claude/types.js";

const DEFAULT_MESSAGE_LIMIT = 40;

function buildSyntheticMessages(
  sample: { info: Message; parts: Part[] },
  claudeMessages: ExtractedMessage[],
  sourceSessionId: string,
): { info: Message; parts: Part[] }[] {
  const sessionID = sample.info.sessionID;
  const createdBase = sample.info.time.created - claudeMessages.length * 1000;

  return claudeMessages.map((m, idx) => {
    const messageID = `msg_cbridge_${sourceSessionId.slice(0, 8)}_${idx}`;
    const createdAt = createdBase + idx * 1000;

    const info: Message = m.role === "user"
      ? {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: createdAt },
          agent: sample.info.role === "user" ? sample.info.agent : "claude-import",
          model: sample.info.role === "user"
            ? sample.info.model
            : { providerID: sample.info.providerID, modelID: sample.info.modelID },
        }
      : {
          id: messageID,
          sessionID,
          role: "assistant",
          time: { created: createdAt, completed: createdAt + 500 },
          parentID: idx === 0 ? messageID : `msg_cbridge_${sourceSessionId.slice(0, 8)}_${idx - 1}`,
          modelID: sample.info.role === "assistant" ? sample.info.modelID : sample.info.model.modelID,
          providerID: sample.info.role === "assistant" ? sample.info.providerID : sample.info.model.providerID,
          mode: sample.info.role === "assistant" ? sample.info.mode : "build",
          path: sample.info.role === "assistant" ? sample.info.path : { cwd: process.cwd(), root: process.cwd() },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        };

    const textPart: Part = {
      id: `prt_cbridge_${sourceSessionId.slice(0, 8)}_${idx}`,
      sessionID,
      messageID,
      type: "text",
      text: m.text,
    };

    return { info, parts: [textPart] };
  });
}

function trimMessage(input: string, maxLength = 12000): string {
  const trimmed = input.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function renderImportResult(input: {
  sessionId: string;
  openCodeSessionId: string;
  lastAssistantMessage?: string;
  totalMessageCount: number;
  loadedMessageCount: number;
  toolOnlyCount: number;
}): string {
  const toolNote = input.toolOnlyCount > 0 ? `, ${input.toolOnlyCount} tool calls` : "";
  const header = `Contexto importado: ${input.loadedMessageCount} mensajes de ${input.totalMessageCount} totales${toolNote}.`;

  if (input.lastAssistantMessage) {
    return `${header}\n\nUltimo mensaje de Claude:\n${trimMessage(input.lastAssistantMessage, 4000)}`;
  }

  return [
    header,
    "No se pudo extraer el ultimo mensaje del asistente.",
    `Sesion Claude: ${input.sessionId}`,
  ].join("\n");
}

export const ClaudeBridgePlugin: Plugin = async (pluginInput) => {
  const workspaceRoot = pluginInput.worktree && pluginInput.worktree !== "/"
    ? pluginInput.worktree
    : pluginInput.directory;
  const store = await createContextStore(workspaceRoot);
  const summaryCache = await createSummaryCache(workspaceRoot);
  const replayMessages = process.env.OPENCODE_CLAUDE_BRIDGE_REPLAY === "1";
  const summaryDisabled = process.env.OPENCODE_CLAUDE_BRIDGE_SUMMARY === "0";
  const debug = createDebugLogger(workspaceRoot);

  debug.log("plugin.init", { workspaceRoot, replayMessages, summaryDisabled });

  async function buildSummaryIfNeeded(
    parsed: ParsedClaudeSession,
    transcriptPath: string,
    directory: string,
  ): Promise<string | undefined> {
    if (summaryDisabled) return undefined;
    if (parsed.olderMessages.length === 0) return undefined;

    let mtimeMs = 0;
    try {
      const s = await stat(transcriptPath);
      mtimeMs = s.mtimeMs;
    } catch {
      return undefined;
    }

    const key = {
      sessionId: parsed.session.sessionId,
      transcriptMtimeMs: mtimeMs,
      olderCount: parsed.olderMessages.length,
    };

    const cached = await summaryCache.get(key);
    if (cached) {
      debug.log("summary.cache_hit", { sessionId: key.sessionId, olderCount: key.olderCount });
      return cached;
    }

    debug.log("summary.generating", { sessionId: key.sessionId, olderCount: key.olderCount });
    const generated = await summarizeOlderMessages(parsed, {
      client: pluginInput.client,
      directory,
      onError: (err, phase) => debug.log("summary.error", { phase, message: err instanceof Error ? err.message : String(err) }),
    });
    if (generated) {
      await summaryCache.set(key, generated);
      debug.log("summary.generated", { sessionId: key.sessionId, chars: generated.length });
    } else {
      debug.log("summary.skipped", { sessionId: key.sessionId, reason: "no text from model" });
    }
    return generated;
  }

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        debug.log("system.transform.skip", { reason: "no sessionID" });
        return;
      }

      const stored = store.getStructured(input.sessionID);
      if (!stored) {
        debug.log("system.transform.skip", { sessionID: input.sessionID, reason: "no stored context" });
        return;
      }

      const useShort = replayMessages && stored.importedContextShort;
      const importedContext = useShort ? stored.importedContextShort! : stored.importedContext;

      output.system.unshift([
        "You are continuing an in-progress conversation that started in Claude Code.",
        "Everything below under \"Our prior conversation\" is what you and the user already said and did together.",
        "Adopt it as your own memory and continue the dialogue naturally — do not treat it as external context you are reading about.",
        "",
        importedContext,
      ].join("\n"));
      debug.log("system.transform.injected", {
        sessionID: input.sessionID,
        mode: useShort ? "short" : "full",
        contextChars: importedContext.length,
      });
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!replayMessages) {
        debug.log("messages.transform.skip", { reason: "replay flag off" });
        return;
      }
      if (output.messages.length === 0) {
        debug.log("messages.transform.skip", { reason: "no messages in output" });
        return;
      }

      const sample = output.messages[0];
      const sessionID = sample.info.sessionID;
      const stored = store.getStructured(sessionID);
      if (!stored?.recentMessages || stored.recentMessages.length === 0) {
        debug.log("messages.transform.skip", { sessionID, reason: "no stored recentMessages", hasContext: !!stored });
        return;
      }

      const alreadyInjected = output.messages.some((m) => m.info.id.startsWith("msg_cbridge_"));
      if (alreadyInjected) {
        debug.log("messages.transform.skip", { sessionID, reason: "already injected" });
        return;
      }

      const synthetic = buildSyntheticMessages(sample, stored.recentMessages, stored.sourceSessionId);
      output.messages.unshift(...synthetic);
      debug.log("messages.transform.injected", {
        sessionID,
        count: synthetic.length,
        beforeCount: output.messages.length - synthetic.length,
        afterCount: output.messages.length,
      });
    },
    tool: {
      resume_claude_last: tool({
        description: "Import the latest local Claude Code session for the current project into this conversation",
        args: {
          projectPath: tool.schema.string().optional().describe("Absolute project path. Defaults to current OpenCode worktree."),
          messageLimit: tool.schema.number().int().min(1).max(60).optional().describe("How many recent transcript messages to include."),
        },
        async execute(args, context) {
          const defaultProjectPath = context.worktree && context.worktree !== "/"
            ? context.worktree
            : context.directory;
          const projectPath = path.resolve(args.projectPath ?? defaultProjectPath);
          const session = await resolveLatestSession(projectPath);
          if (!session) {
            return [
              `No Claude session was found for project path: ${projectPath}`,
              "Expected Claude transcripts under ~/.claude/projects/...",
            ].join("\n");
          }

          const parsed = await parseClaudeTranscript(session, args.messageLimit ?? DEFAULT_MESSAGE_LIMIT);
          const summary = await buildSummaryIfNeeded(parsed, session.transcriptPath, projectPath);
          const importedContext = formatImportedContext(parsed, "full", { summary });
          const importedContextShort = formatImportedContext(parsed, "metadata-only", { summary });
          await store.save(context.sessionID, {
            importedContext,
            importedContextShort,
            sourceSessionId: session.sessionId,
            importedAt: new Date().toISOString(),
            recentMessages: parsed.recentMessages,
          });
          debug.log("tool.resume_claude_last", {
            openCodeSessionID: context.sessionID,
            claudeSessionID: session.sessionId,
            totalMessages: parsed.totalMessageCount,
            loadedMessages: parsed.recentMessages.length,
            olderMessages: parsed.olderMessages.length,
            summarized: !!summary,
          });
          context.metadata({
            title: "Imported Claude session",
            metadata: {
              sessionId: session.sessionId,
              projectPath,
              importedIntoSession: context.sessionID,
            },
          });
          return renderImportResult({
            sessionId: session.sessionId,
            openCodeSessionId: context.sessionID,
            lastAssistantMessage: parsed.lastAssistantMessage,
            totalMessageCount: parsed.totalMessageCount,
            loadedMessageCount: parsed.recentMessages.length,
            toolOnlyCount: parsed.recentMessages.filter((m) => m.isToolOnly).length,
          });
        },
      }),
      resume_claude_session: tool({
        description: "Import a specific local Claude Code session by session ID into this conversation",
        args: {
          sessionId: tool.schema.string().min(1).describe("Claude Code session ID, for example 48c461da-67ba-4368-be93-88815f351a3a."),
          messageLimit: tool.schema.number().int().min(1).max(60).optional().describe("How many recent transcript messages to include."),
        },
        async execute(args, context) {
          const session = await resolveSessionById(args.sessionId);
          if (!session) {
            return `Claude session not found for ID: ${args.sessionId}`;
          }

          const parsed = await parseClaudeTranscript(session, args.messageLimit ?? DEFAULT_MESSAGE_LIMIT);
          const directoryForSummary = context.worktree && context.worktree !== "/"
            ? context.worktree
            : context.directory;
          const summary = await buildSummaryIfNeeded(parsed, session.transcriptPath, directoryForSummary);
          const importedContext = formatImportedContext(parsed, "full", { summary });
          const importedContextShort = formatImportedContext(parsed, "metadata-only", { summary });
          await store.save(context.sessionID, {
            importedContext,
            importedContextShort,
            sourceSessionId: session.sessionId,
            importedAt: new Date().toISOString(),
            recentMessages: parsed.recentMessages,
          });
          debug.log("tool.resume_claude_session", {
            openCodeSessionID: context.sessionID,
            claudeSessionID: session.sessionId,
            totalMessages: parsed.totalMessageCount,
            loadedMessages: parsed.recentMessages.length,
            olderMessages: parsed.olderMessages.length,
            summarized: !!summary,
          });
          context.metadata({
            title: "Imported Claude session by ID",
            metadata: {
              sessionId: session.sessionId,
              transcriptPath: session.transcriptPath,
              importedIntoSession: context.sessionID,
            },
          });
          return renderImportResult({
            sessionId: session.sessionId,
            openCodeSessionId: context.sessionID,
            lastAssistantMessage: parsed.lastAssistantMessage,
            totalMessageCount: parsed.totalMessageCount,
            loadedMessageCount: parsed.recentMessages.length,
            toolOnlyCount: parsed.recentMessages.filter((m) => m.isToolOnly).length,
          });
        },
      }),
    },
  };
};

export const server = ClaudeBridgePlugin;
export default ClaudeBridgePlugin;
