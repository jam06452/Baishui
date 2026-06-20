import { randomBytes, createHash } from "node:crypto";

const KEY_PREFIX = "sk-or-";
const MGMT_PREFIX = "mgmt-";

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX}${secret}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = `${KEY_PREFIX}${secret.slice(0, 8)}...`;
  return { key, hash, prefix };
}

export function generateManagementKey(): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `${MGMT_PREFIX}${secret}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = `${MGMT_PREFIX}${secret.slice(0, 8)}...`;
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}