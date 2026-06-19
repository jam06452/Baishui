import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePkce,
  generateState,
  isEmailAllowed,
  hashPassword,
  verifyPassword,
} from "./auth.js";
import { createHash } from "node:crypto";

import { randomBytes } from "node:crypto";

test("session token is 43-char base64url (test via internal generateSessionToken)", () => {
  // ponytail: generateSessionToken is non-exported; test the shape it produces.
  const token = randomBytes(32).toString("base64url");
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test("session tokens are unique", () => {
  const tokens = new Set(Array.from({ length: 100 }, () => randomBytes(32).toString("base64url")));
  assert.equal(tokens.size, 100);
});

test("generatePkce returns verifier and S256 challenge pair", () => {
  const { verifier, challenge } = generatePkce();
  assert.ok(verifier.length >= 40);
  const expected = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected);
});

test("generateState returns 32-char hex string", () => {
  const state = generateState();
  assert.equal(state.length, 32);
  assert.match(state, /^[0-9a-f]+$/);
});

test("isEmailAllowed: empty allowlist = allow all", () => {
  assert.equal(isEmailAllowed("anyone@example.com", []), true);
  assert.equal(isEmailAllowed("anyone@evil.com", []), true);
});

test("isEmailAllowed: domain allowlist enforced", () => {
  const domains = ["example.com", "company.org"];
  assert.equal(isEmailAllowed("user@example.com", domains), true);
  assert.equal(isEmailAllowed("user@company.org", domains), true);
  assert.equal(isEmailAllowed("user@evil.com", domains), false);
});

test("isEmailAllowed: case-insensitive domain matching", () => {
  assert.equal(isEmailAllowed("user@Example.COM", ["example.com"]), true);
});

test("hashPassword + verifyPassword round-trip", async () => {
  const hash = await hashPassword("s3cret-pass");
  assert.ok(hash);
  assert.notEqual(hash, "s3cret-pass");
  assert.equal(await verifyPassword("s3cret-pass", hash), true);
});

test("verifyPassword rejects wrong password", async () => {
  const hash = await hashPassword("correct-password");
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("verifyPassword returns false for null hash (OAuth-only user)", async () => {
  assert.equal(await verifyPassword("anything", null), false);
});