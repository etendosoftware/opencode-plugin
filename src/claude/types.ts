export type ClaudeSessionIndexEntry = {
  sessionId: string;
  fullPath: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
};

export type ClaudeTranscriptEvent = Record<string, unknown>;

export type ClaudeSessionRecord = {
  sessionId: string;
  transcriptPath: string;
  projectPath: string;
  projectKey: string;
  summary?: string;
  firstPrompt?: string;
  modified?: string;
  gitBranch?: string;
  messageCount?: number;
};

export type ExtractedMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
  isToolOnly?: boolean;
};

export type ParsedClaudeSession = {
  session: ClaudeSessionRecord;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  firstUserPrompt?: string;
  lastAssistantMessage?: string;
  totalMessageCount: number;
  openingMessages: ExtractedMessage[];
  keyUserMessages: ExtractedMessage[];
  additionalContext: string[];
  detectedSkills: string[];
  detectedMcpServers: string[];
  recentMessages: ExtractedMessage[];
  detectedLanguage?: "es" | "en" | "mixed";
};
