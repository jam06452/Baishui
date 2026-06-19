import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIAdapter, AnthropicAdapter } from "./index.js";
import type { Model, Provider } from "@baishui/db";

const mockModel = { id: "m1", upstreamId: "gpt-4o", displayName: "gpt-4o", providerId: "p1" } as unknown as Model;
const mockProvider = { id: "p1", name: "openai", type: "openai", baseUrl: "https://api.openai.com" } as unknown as Provider;
const anthropicModel = { id: "m2", upstreamId: "claude-3-5-sonnet-20241022", displayName: "claude", providerId: "p2" } as unknown as Model;
const anthropicProvider = { id: "p2", name: "anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com" } as unknown as Provider;

test("OpenAIAdapter: buildCall uses /v1/chat/completions with Bearer auth", () => {
  const call = OpenAIAdapter.buildCall({ model: "gpt-4o", messages: [] }, mockModel, mockProvider, "secret");
  assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(call.headers.Authorization, "Bearer secret");
  assert.equal(call.method, "POST");
});

test("OpenAIAdapter: buildCall swaps model for upstreamId", () => {
  const call = OpenAIAdapter.buildCall({ model: "alias-name", messages: [] }, mockModel, mockProvider, "secret");
  assert.equal((call.body as { model: string }).model, "gpt-4o");
});

test("OpenAIAdapter: normalizeResponse parses usage from OpenAI shape", () => {
  const openaiRes = JSON.stringify({
    id: "x", object: "chat.completion", model: "gpt-4o",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  const { body, usage } = OpenAIAdapter.normalizeResponse(openaiRes);
  assert.equal(usage.inputTokens, 10);
  assert.equal(usage.outputTokens, 5);
  assert.ok((body as { choices: unknown[] }).choices.length === 1);
});

test("OpenAIAdapter: stream chunk passthrough", () => {
  const ctx = { started: false, model: "gpt-4o", created: 123, modelId: "m1" };
  const chunk = JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [] });
  const { outputs, done } = OpenAIAdapter.normalizeStreamChunk(chunk, ctx);
  assert.equal(outputs.length, 1);
  assert.equal(done, false);
});

test("OpenAIAdapter: [DONE] passthrough", () => {
  const ctx = { started: false, model: "gpt-4o", created: 123, modelId: "m1" };
  const { outputs, done } = OpenAIAdapter.normalizeStreamChunk("[DONE]", ctx);
  assert.equal(outputs[0], "[DONE]");
  assert.equal(done, true);
});

test("AnthropicAdapter: buildCall uses /v1/messages with x-api-key", () => {
  const call = AnthropicAdapter.buildCall({ model: "claude", messages: [{ role: "user", content: "hi" }] }, anthropicModel, anthropicProvider, "sk-ant");
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(call.headers["x-api-key"], "sk-ant");
  assert.equal(call.headers["anthropic-version"], "2023-06-01");
});

test("AnthropicAdapter: buildCall extracts system message to top-level", () => {
  const call = AnthropicAdapter.buildCall(
    { model: "claude", messages: [{ role: "system", content: "be nice" }, { role: "user", content: "hi" }] },
    anthropicModel, anthropicProvider, "secret",
  );
  const body = call.body as { system?: string; messages: { role: string }[] };
  assert.equal(body.system, "be nice");
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0]!.role, "user");
});

test("AnthropicAdapter: buildCall merges multiple system messages", () => {
  const call = AnthropicAdapter.buildCall(
    { model: "claude", messages: [{ role: "system", content: "a" }, { role: "system", content: "b" }, { role: "user", content: "x" }] },
    anthropicModel, anthropicProvider, "secret",
  );
  const body = call.body as { system?: string };
  assert.equal(body.system, "a\n\nb");
});

test("AnthropicAdapter: normalizeResponse returns OpenAI shape", () => {
  const anthropicRes = JSON.stringify({
    id: "msg_1", type: "message", role: "assistant",
    content: [{ type: "text", text: "hello" }],
    model: "claude-3-5-sonnet-20241022", stop_reason: "end_turn",
    usage: { input_tokens: 8, output_tokens: 3 },
  });
  const { body, usage } = AnthropicAdapter.normalizeResponse(anthropicRes);
  assert.equal(usage.inputTokens, 8);
  assert.equal(usage.outputTokens, 3);
  const b = body as { object: string; choices: { message: { content: string }; finish_reason: string }[] };
  assert.equal(b.object, "chat.completion");
  assert.equal(b.choices[0]!.message.content, "hello");
  assert.equal(b.choices[0]!.finish_reason, "stop");
});

test("AnthropicAdapter: stream message_start emits role chunk + input usage", () => {
  const ctx = { started: false, model: "claude", created: 123, modelId: "m2" };
  const data = JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 12 } } });
  const { outputs, finalUsage } = AnthropicAdapter.normalizeStreamChunk(data, ctx);
  assert.equal(outputs.length, 1);
  assert.ok(finalUsage);
  assert.equal(finalUsage!.inputTokens, 12);
  assert.ok(ctx.started);
});

test("AnthropicAdapter: stream content_block_delta emits content chunk", () => {
  const ctx = { started: true, model: "claude", created: 123, modelId: "m2" };
  const data = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } });
  const { outputs } = AnthropicAdapter.normalizeStreamChunk(data, ctx);
  assert.equal(outputs.length, 1);
  const chunk = JSON.parse(outputs[0]!) as { choices: { delta: { content?: string } }[] };
  assert.equal(chunk.choices[0]!.delta.content, "hello");
});

test("AnthropicAdapter: stream message_delta emits finish_reason + output usage", () => {
  const ctx = { started: true, model: "claude", created: 123, modelId: "m2" };
  const data = JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } });
  const { outputs, finalUsage } = AnthropicAdapter.normalizeStreamChunk(data, ctx);
  assert.equal(outputs.length, 1);
  const chunk = JSON.parse(outputs[0]!) as { choices: { finish_reason: string }[] };
  assert.equal(chunk.choices[0]!.finish_reason, "stop");
  assert.ok(finalUsage);
  assert.equal(finalUsage!.outputTokens, 42);
});

test("AnthropicAdapter: stream message_stop signals done", () => {
  const ctx = { started: true, model: "claude", created: 123, modelId: "m2" };
  const data = JSON.stringify({ type: "message_stop" });
  const { done } = AnthropicAdapter.normalizeStreamChunk(data, ctx);
  assert.equal(done, true);
});

test("OpenAIAdapter: mapError categorizes correctly", () => {
  assert.deepEqual(OpenAIAdapter.mapError(429), { kind: "rate_limit", retryable: true });
  assert.deepEqual(OpenAIAdapter.mapError(401), { kind: "auth", retryable: false });
  assert.deepEqual(OpenAIAdapter.mapError(500), { kind: "server", retryable: true });
  assert.deepEqual(OpenAIAdapter.mapError(400), { kind: "client", retryable: false });
});

test("AnthropicAdapter: mapError mirrors OpenAI mapping", () => {
  assert.deepEqual(AnthropicAdapter.mapError(429), { kind: "rate_limit", retryable: true });
  assert.deepEqual(AnthropicAdapter.mapError(403), { kind: "auth", retryable: false });
});