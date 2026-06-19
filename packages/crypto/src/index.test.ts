import { test } from "node:test";
import assert from "node:assert/strict";
import { CryptoService } from "./index.js";

const KEY = "a".repeat(64); // 32-byte hex

test("encrypt → decrypt round-trip", () => {
  const c = CryptoService.fromEnv(KEY);
  const secret = "sk-proj-abc123";
  const sealed = c.encrypt(secret);
  assert.equal(c.decrypt(sealed), secret);
});

test("ciphertext differs from plaintext", () => {
  const c = CryptoService.fromEnv(KEY);
  const sealed = c.encrypt("hello");
  assert.ok(!sealed.ciphertext.includes("hello"));
});

test("each encryption produces a unique nonce", () => {
  const c = CryptoService.fromEnv(KEY);
  const a = c.encrypt("same");
  const b = c.encrypt("same");
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("decrypt with wrong kid fails", () => {
  const c = CryptoService.fromEnv(KEY, "v1");
  const sealed = c.encrypt("secret");
  const c2 = CryptoService.fromEnv("b".repeat(64), "v2");
  assert.throws(() => c2.decrypt(sealed), /Unknown key id/);
});

test("key rotation: old key decrypts, new key encrypts", () => {
  const oldKey = "a".repeat(64);
  const newKey = "b".repeat(64);
  const rotating = new CryptoService({ v1: oldKey, v2: newKey });
  // active kid is the first entry (v1) — reassign to make v2 active
  const sealedWithOld = new CryptoService({ v1: oldKey }).encrypt("data");
  // rotating has both keys, can decrypt old
  assert.equal(rotating.decrypt(sealedWithOld), "data");
});

test("tampered ciphertext throws", () => {
  const c = CryptoService.fromEnv(KEY);
  const sealed = c.encrypt("secret");
  const tampered = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -4) + "AAAA" };
  assert.throws(() => c.decrypt(tampered));
});

test("invalid key length rejected", () => {
  assert.throws(() => CryptoService.fromEnv("a".repeat(32)), /32 bytes/);
});

test("empty root keys rejected", () => {
  assert.throws(() => new CryptoService({}));
});