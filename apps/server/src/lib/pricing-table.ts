// ponytail: built-in pricing fallback for providers that don't expose pricing
// via /v1/models (DigitalOcean is the main one). Sourced from
// https://docs.digitalocean.com/products/inference/details/pricing/
// Last updated: 2026-06-19. Update this file when DO changes their prices.
// Prices are per 1M tokens in USD.

export const BUILTIN_PRICING: Record<string, { input: string; output: string }> = {
  // ── Anthropic (via DO) ──────────────────────────────────────
  "anthropic-claude-haiku-4.5":    { input: "1.00",  output: "5.00"  },
  "anthropic-claude-opus-4.8":     { input: "5.00",  output: "25.00" },
  "anthropic-claude-opus-4.7":     { input: "5.00",  output: "25.00" },
  "anthropic-claude-opus-4.6":     { input: "5.00",  output: "25.00" },
  "anthropic-claude-opus-4.5":     { input: "5.00",  output: "25.00" },
  "anthropic-claude-opus-4.1":     { input: "15.00", output: "75.00" },
  "anthropic-claude-4.6-sonnet":   { input: "3.00",  output: "15.00" },
  "anthropic-claude-4.5-sonnet":   { input: "3.00",  output: "15.00" },
  // ── OpenAI (via DO) ─────────────────────────────────────────
  "openai-gpt-5.5":                { input: "5.00",  output: "30.00" },
  "openai-gpt-5.4":                { input: "2.50",  output: "15.00" },
  "openai-gpt-5.4-mini":           { input: "0.75",  output: "4.50"  },
  "openai-gpt-5.4-nano":           { input: "0.20",  output: "1.25"  },
  "openai-gpt-5.4-pro":            { input: "30.00", output: "180.00"},
  "openai-gpt-5.3-codex":          { input: "1.75",  output: "14.00" },
  "openai-gpt-5.2":                { input: "1.75",  output: "14.00" },
  "openai-gpt-5.2-pro":            { input: "21.00", output: "168.00"},
  "openai-gpt-5.1-codex-max":      { input: "1.25",  output: "10.00" },
  "openai-gpt-5":                  { input: "1.25",  output: "10.00" },
  "openai-gpt-5-mini":             { input: "0.25",  output: "2.00"  },
  "openai-gpt-5-nano":             { input: "0.05",  output: "0.40"  },
  "openai-gpt-4.1":                { input: "2.00",  output: "8.00"  },
  "openai-gpt-4o":                 { input: "2.50",  output: "10.00" },
  "openai-gpt-4o-mini":            { input: "0.15",  output: "0.60"  },
  "openai-o1":                     { input: "15.00", output: "60.00" },
  "openai-o3":                     { input: "2.00",  output: "8.00"  },
  "openai-o3-mini":                { input: "1.10",  output: "4.40"  },
  "openai-gpt-oss-120b":           { input: "0.10",  output: "0.70"  },
  "openai-gpt-oss-20b":            { input: "0.05",  output: "0.45"  },
  // ── DO-hosted models ────────────────────────────────────────
  "alibaba-qwen3-32b":             { input: "0.25",  output: "0.55"  },
  "qwen3-coder-flash":             { input: "0.45",  output: "1.70"  },
  "qwen3.5-397b-a17b":             { input: "0.55",  output: "3.50"  },
  "deepseek-r1-distill-llama-70b": { input: "0.99",  output: "0.99"  },
  "deepseek-v4-pro":               { input: "1.74",  output: "3.48"  },
  "deepseek-4-flash":              { input: "0.14",  output: "0.28"  },
  "deepseek-3.2":                  { input: "0.50",  output: "1.60"  },
  "gemma-4-31B-it":                { input: "0.18",  output: "0.50"  },
  "minimax-m2.5":                  { input: "0.30",  output: "1.20"  },
  "kimi-k2.5":                     { input: "0.50",  output: "2.70"  },
  "kimi-k2.6":                     { input: "0.95",  output: "4.00"  },
  "llama3.3-70b-instruct":         { input: "0.65",  output: "0.65"  },
  "llama-4-maverick":              { input: "0.25",  output: "0.87"  },
  "mistral-3-14B":                 { input: "0.20",  output: "0.20"  },
  "nemotron-3-ultra-550b":         { input: "0.90",  output: "1.70"  },
  "nvidia-nemotron-3-super-120b":  { input: "0.30",  output: "0.65"  },
  "nemotron-3-nano-omni":          { input: "0.50",  output: "0.90"  },
  "nemotron-nano-12b-v2-vl":       { input: "0.20",  output: "0.60"  },
  "mimo-v2.5":                     { input: "0.14",  output: "0.28"  },
  "mimo-v2.5-pro":                 { input: "0.80",  output: "3.00"  },
  "glm-5":                         { input: "1.00",  output: "3.20"  },
  "arcee-trinity-large-thinking":  { input: "0.25",  output: "0.90"  },
  // ── Embeddings (output = 0) ─────────────────────────────────
  "all-mini-lm-l6-v2":             { input: "0.009", output: "0"     },
  "multi-qa-mpnet-base-dot-v1":    { input: "0.009", output: "0"     },
  "gte-large-en-v1.5":             { input: "0.09",  output: "0"     },
  "qwen3-embedding-0.6b":          { input: "0.04",  output: "0"     },
  "bge-m3":                        { input: "0.02",  output: "0"     },
  "e5-large-v2":                   { input: "0.02",  output: "0"     },
};

/** Extract pricing from upstream model response + built-in fallback table.
 *  Returns null if no pricing found (user must set manually). */
export function extractPricing(um: Record<string, unknown>): { input: string | null; output: string | null } {
  // Tier 1: upstream API pricing fields
  const pricing = um.pricing as Record<string, number> | undefined;
  const cost = um.cost as Record<string, number> | undefined;
  const inputPrice  = pricing?.input_per_mtok ?? cost?.input ?? null;
  const outputPrice = pricing?.output_per_mtok ?? cost?.output ?? null;

  if (inputPrice !== null && outputPrice !== null) {
    return { input: String(inputPrice), output: String(outputPrice) };
  }

  // Tier 2: built-in fallback table (keyed by model ID)
  const id = um.id as string;
  if (id && BUILTIN_PRICING[id]) {
    return { input: BUILTIN_PRICING[id]!.input, output: BUILTIN_PRICING[id]!.output };
  }

  return { input: inputPrice !== null ? String(inputPrice) : null, output: outputPrice !== null ? String(outputPrice) : null };
}

/** Extract context window from upstream model response. */
export function extractContextWindow(um: Record<string, unknown>): number | null {
  return um.context_length as number ?? um.max_context_tokens as number ?? um.context_window as number ?? null;
}