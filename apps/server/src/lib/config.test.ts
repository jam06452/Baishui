import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, _resetConfigCache, isGitHubOAuthEnabled, parseAllowedEmailDomains } from "./config.js";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const originals: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    originals[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetConfigCache();
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetConfigCache();
  }
}

const VALID = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  PROXY_ENCRYPTION_ROOT_KEY: "a".repeat(64),
};

test("loads with minimal valid env", () => {
  withEnv({ ...VALID, NODE_ENV: "test" }, () => {
    const c = loadConfig();
    assert.equal(c.PORT, 8080);
    assert.equal(c.ROLE, "proxy");
    assert.equal(c.LOG_LEVEL, "info");
  });
});

test("missing DATABASE_URL throws", () => {
  withEnv({ ...VALID, DATABASE_URL: undefined, NODE_ENV: "test" }, () => {
    assert.throws(() => loadConfig(), /DATABASE_URL/);
  });
});

test("invalid encryption key length throws", () => {
  withEnv({ ...VALID, PROXY_ENCRYPTION_ROOT_KEY: "a".repeat(32), NODE_ENV: "test" }, () => {
    assert.throws(() => loadConfig(), /64 chars/);
  });
});

test("non-hex encryption key throws", () => {
  withEnv({ ...VALID, PROXY_ENCRYPTION_ROOT_KEY: "z".repeat(64), NODE_ENV: "test" }, () => {
    assert.throws(() => loadConfig(), /hex/);
  });
});

test("invalid ROLE throws", () => {
  withEnv({ ...VALID, ROLE: "bogus", NODE_ENV: "test" }, () => {
    assert.throws(() => loadConfig());
  });
});

test("PORT coerced to number", () => {
  withEnv({ ...VALID, PORT: "3000", NODE_ENV: "test" }, () => {
    assert.equal(loadConfig().PORT, 3000);
  });
});

test("REDIS_URL optional", () => {
  withEnv({ ...VALID, REDIS_URL: undefined, NODE_ENV: "test" }, () => {
    assert.equal(loadConfig().REDIS_URL, undefined);
  });
});

test("GitHub OAuth vars default to empty strings", () => {
  withEnv({ ...VALID, NODE_ENV: "test" }, () => {
    const c = loadConfig();
    assert.equal(c.GITHUB_CLIENT_ID, "");
    assert.equal(c.GITHUB_CLIENT_SECRET, "");
    assert.equal(c.GITHUB_REDIRECT_URI, "");
    assert.equal(c.OAUTH_ALLOWED_EMAIL_DOMAINS, "");
  });
});

test("isGitHubOAuthEnabled: false when any required var missing", () => {
  withEnv({ ...VALID, GITHUB_CLIENT_ID: "id", NODE_ENV: "test" }, () => {
    const c = loadConfig();
    assert.equal(isGitHubOAuthEnabled(c), false);
  });
  withEnv({ ...VALID, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", GITHUB_REDIRECT_URI: "http://x/cb", NODE_ENV: "test" }, () => {
    const c = loadConfig();
    assert.equal(isGitHubOAuthEnabled(c), true);
  });
});

test("parseAllowedEmailDomains: empty string = empty array", () => {
  withEnv({ ...VALID, OAUTH_ALLOWED_EMAIL_DOMAINS: "", NODE_ENV: "test" }, () => {
    const c = loadConfig();
    assert.deepEqual(parseAllowedEmailDomains(c), []);
  });
});

test("parseAllowedEmailDomains: comma-separated parsing + trim + lowercase", () => {
  withEnv({ ...VALID, OAUTH_ALLOWED_EMAIL_DOMAINS: " Example.com , Company.org ,, ", NODE_ENV: "test" }, () => {
    const c = loadConfig();
    assert.deepEqual(parseAllowedEmailDomains(c), ["example.com", "company.org"]);
  });
});