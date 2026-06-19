import type { Model, Provider } from "@baishui/db";

// ponytail: adapter interface extracted now that Phase 5 adds a second shape.
// Until now /v1 was OpenAI-compatible passthrough. Anthropic needs translation.

export interface ChatRequest {
  model: string;
  messages: unknown[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface UpstreamCall {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: unknown;
}

export interface Adapter {
  /** Translate client chat request → upstream HTTP call. */
  buildCall(req: ChatRequest, model: Model, provider: Provider, secret: string): UpstreamCall;
  /** Translate non-stream upstream response body → OpenAI-shaped object. Returns parsed + usage. */
  normalizeResponse(text: string): { body: unknown; usage: TokenUsage };
  /** For streams: transform one SSE chunk text → array of OpenAI-shaped SSE data strings. */
  normalizeStreamChunk(data: string, ctx: StreamCtx): { outputs: string[]; finalUsage?: TokenUsage; done: boolean };
  /** Map upstream status → error kind (drives circuit breaker). */
  mapError(status: number): { kind: "rate_limit" | "auth" | "server" | "client"; retryable: boolean };
}

export interface StreamCtx {
  // mutable across chunks; adapters track state (message_id, content_index, etc.)
  started: boolean;
  model: string;
  created: number;
  modelId: string;
}

/** OpenAI-compatible passthrough — works for OpenAI, Together, Mistral, Groq, etc. */
export const OpenAIAdapter: Adapter = {
  buildCall(req, model, provider, secret) {
    const base = provider.baseUrl?.replace(/\/$/, "") ?? "";
    return {
      url: `${base}/v1/chat/completions`,
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: { ...req, model: model.upstreamId },
    };
  },
  normalizeResponse(text) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch {}
    const u = (parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    return { body: parsed ?? text, usage: { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 } };
  },
  normalizeStreamChunk(data, _ctx) {
    // OpenAI chunks are already the right shape — passthrough.
    if (data === "[DONE]") return { outputs: ["[DONE]"], done: true };
    let usage: TokenUsage | undefined;
    try {
      const chunk = JSON.parse(data) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
    } catch {}
    return { outputs: [data], finalUsage: usage, done: false };
  },
  mapError(status) {
    if (status === 429) return { kind: "rate_limit", retryable: true };
    if (status === 401 || status === 403) return { kind: "auth", retryable: false };
    if (status >= 500) return { kind: "server", retryable: true };
    return { kind: "client", retryable: false };
  },
};