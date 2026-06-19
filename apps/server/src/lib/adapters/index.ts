import type { Adapter } from "./openai.js";
import { OpenAIAdapter } from "./openai.js";
import { AnthropicAdapter } from "./anthropic.js";

// ponytail: registry by provider type. Only two shapes today: OpenAI-compat passthrough
// and Anthropic. Google/Cohere add new keys when they appear.
const registry: Record<string, Adapter> = {
  openai_compatible: OpenAIAdapter,
  openai: OpenAIAdapter,
  mistral: OpenAIAdapter,
  together: OpenAIAdapter,
  groq: OpenAIAdapter,
  fireworks: OpenAIAdapter,
  deepseek: OpenAIAdapter,
  azure_openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
};

export function getAdapter(providerType: string): Adapter {
  return registry[providerType] ?? OpenAIAdapter;
}

export { OpenAIAdapter, AnthropicAdapter };
export type { Adapter, ChatRequest, TokenUsage, StreamCtx } from "./openai.js";