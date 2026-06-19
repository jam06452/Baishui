import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey } from "./api-key.js";

test("generateApiKey returns sk-or- prefixed key", () => {
  const { key, hash, prefix } = generateApiKey();
  assert.ok(key.startsWith("sk-or-"));
  assert.ok(hash.length === 64);
  assert.ok(prefix.startsWith("sk-or-"));
  assert.ok(prefix.endsWith("..."));
});

test("hashApiKey is deterministic", () => {
  const { key } = generateApiKey();
  assert.equal(hashApiKey(key), hashApiKey(key));
});

test("hashApiKey differs for different keys", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.notEqual(a.hash, b.hash);
});

test("prefix reveals only first 8 chars after prefix", () => {
  const { key, prefix } = generateApiKey();
  const secret = key.slice("sk-or-".length);
  assert.equal(prefix, `sk-or-${secret.slice(0, 8)}...`);
});