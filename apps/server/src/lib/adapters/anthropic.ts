import type { Adapter, ChatRequest, TokenUsage, StreamCtx } from "./openai.js";

// ponytail: Anthropic Messages API differs enough to need translation:
// - system is top-level, not a message
// - SSE events: message_start, content_block_start/delta/stop, message_delta, message_stop
// - usage arrives in message_start (input) and message_delta (output)

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | { type: "text"; text: string }[];
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: { type: "text"; text: string }[];
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

function translateMessages(req: ChatRequest): { system: string | undefined; messages: AnthropicMessage[] } {
  const msgs = req.messages as { role: string; content: string }[];
  let system: string | undefined;
  const out: AnthropicMessage[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      system = (system ? system + "\n\n" : "") + m.content;
    } else if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }
  return { system, messages: out };
}

function toOpenAIResponse(an: AnthropicResponse): unknown {
  return {
    id: an.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: an.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: an.content.map((c) => c.text).join("") },
      finish_reason: an.stop_reason === "end_turn" ? "stop" : (an.stop_reason ?? "stop"),
    }],
    usage: { prompt_tokens: an.usage.input_tokens, completion_tokens: an.usage.output_tokens, total_tokens: an.usage.input_tokens + an.usage.output_tokens },
  };
}

function openAIChunk(model: string, created: number, delta: Record<string, unknown>, finishReason: string | null, modelId: string): string {
  return JSON.stringify({
    id: modelId, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

export const AnthropicAdapter: Adapter = {
  buildCall(req, model, provider, secret) {
    const base = provider.baseUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
    const { system, messages } = translateMessages(req);
    const body: Record<string, unknown> = {
      model: model.upstreamId,
      messages,
      max_tokens: req.max_tokens ?? 1024,
      stream: req.stream === true,
    };
    if (system !== undefined) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return {
      url: `${base}/v1/messages`,
      method: "POST",
      headers: {
        "x-api-key": secret,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body,
    };
  },

  normalizeResponse(text) {
    const an = JSON.parse(text) as AnthropicResponse;
    return { body: toOpenAIResponse(an), usage: { inputTokens: an.usage.input_tokens, outputTokens: an.usage.output_tokens } };
  },

  normalizeStreamChunk(data, ctx: StreamCtx): { outputs: string[]; finalUsage?: TokenUsage; done: boolean } {
    if (data === "[DONE]") return { outputs: ["[DONE]"], done: true };
    let event: { type: string; [k: string]: unknown };
    try { event = JSON.parse(data); } catch { return { outputs: [], done: false }; }

    const created = ctx.created;
    const model = ctx.model;
    const modelId = ctx.modelId;
    const outputs: string[] = [];

    switch (event.type) {
      case "message_start": {
        ctx.started = true;
        const msg = event.message as { usage: { input_tokens: number } };
        // ponytail: emit an empty first chunk with role (OpenAI convention)
        outputs.push(openAIChunk(model, created, { role: "assistant", content: "" }, null, modelId));
        return { outputs, finalUsage: { inputTokens: msg.usage.input_tokens, outputTokens: 0 }, done: false };
      }
      case "content_block_delta": {
        const delta = event.delta as { type: string; text?: string };
        if (delta.text) {
          outputs.push(openAIChunk(model, created, { content: delta.text }, null, modelId));
        }
        return { outputs, done: false };
      }
      case "message_delta": {
        const delta = event.delta as { stop_reason: string | null };
        const usage = event.usage as { output_tokens?: number } | undefined;
        const finishReason = delta.stop_reason === "end_turn" ? "stop" : (delta.stop_reason ?? "stop");
        outputs.push(openAIChunk(model, created, {}, finishReason, modelId));
        // dummy avoid unused-var
        void usage;
        const finalUsage = usage ? { inputTokens: 0, outputTokens: usage.output_tokens ?? 0 } : undefined;
        return { outputs, finalUsage, done: false };
      }
      case "message_stop": {
        return { outputs, done: true };
      }
      default:
        return { outputs, done: false };
    }
  },

  mapError(status) {
    if (status === 429) return { kind: "rate_limit", retryable: true };
    if (status === 401 || status === 403) return { kind: "auth", retryable: false };
    if (status >= 500) return { kind: "server", retryable: true };
    return { kind: "client", retryable: false };
  },
};