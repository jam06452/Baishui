import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_PROXY } from "./middleware.js";

test("MAX_BODY_PROXY is 10 MiB", () => {
  // ponytail: this asserts the proxy can carry large completions but caps DoS.
  assert.equal(MAX_BODY_PROXY, 10 * 1024 * 1024);
});

// ponytail: body size limit is enforced via Hono middleware — fully testing
// it requires running a live server. The integration test (e2e test suite)
// covers the runtime behavior: a 1MB+ login body should 413. Here we just
// assert the constants.
test("MAX_BODY_PROXY is at least 4 MiB (LLM prompts can get long)", () => {
  assert.ok(MAX_BODY_PROXY >= 4 * 1024 * 1024);
});