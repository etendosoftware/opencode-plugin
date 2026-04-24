export type TokenDelta = {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  cost: number;
};

export type SessionTotals = {
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
};

export const ZERO_TOTALS: SessionTotals = {
  tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  cost_usd: 0,
};

export class SessionTracker {
  private sessions = new Map<string, SessionTotals>();

  isNew(sessionId: string): boolean {
    return !this.sessions.has(sessionId);
  }

  add(sessionId: string, delta: TokenDelta): SessionTotals {
    const prev = this.sessions.get(sessionId) ?? { ...ZERO_TOTALS };
    const next: SessionTotals = {
      input_tokens: prev.input_tokens + delta.input,
      output_tokens: prev.output_tokens + delta.output,
      cache_creation_tokens: prev.cache_creation_tokens + delta.cache_creation,
      cache_read_tokens: prev.cache_read_tokens + delta.cache_read,
      tokens: prev.tokens + delta.input + delta.output + delta.cache_creation + delta.cache_read,
      cost_usd: prev.cost_usd + delta.cost,
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  get(sessionId: string): SessionTotals | undefined {
    return this.sessions.get(sessionId);
  }
}
