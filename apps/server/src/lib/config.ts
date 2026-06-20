import { z } from "zod";

const envSchema = z.object({
  ROLE: z.enum(["proxy", "worker", "all", "web"]).default("proxy"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(50),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // Cache TTLs (seconds). 0 disables caching — every request hits DB fresh.
  // ponytail: disabled by default to prevent stale data in the UI. Re-enable
  // (set to 60) only if DB load becomes a bottleneck under high RPS.
  CACHE_TTL_AUTH_S: z.coerce.number().int().nonnegative().default(0),
  CACHE_TTL_MODEL_S: z.coerce.number().int().nonnegative().default(0),
  // Usage logging buffer: flush every N ms OR when N logs queued (whichever first).
  USAGE_FLUSH_MS: z.coerce.number().int().positive().default(1000),
  USAGE_FLUSH_BATCH: z.coerce.number().int().positive().default(500),
  PROXY_ENCRYPTION_ROOT_KEY: z
    .string()
    .length(64, "PROXY_ENCRYPTION_ROOT_KEY must be 32 bytes hex (64 chars)")
    .regex(/^[0-9a-fA-F]{64}$/, "must be hex"),
  // Unattended setup (CI/Helm/headless): set ALLOW_UNATTENDED_SETUP=1 + ADMIN_EMAIL + ADMIN_PASSWORD
  // to bootstrap the owner at first boot. Default (unset) = use the setup wizard at / .
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ALLOW_UNATTENDED_SETUP: z.string().optional().default(""),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_REDIRECT_URI: z.string().optional().default(""),
  OAUTH_ALLOWED_EMAIL_DOMAINS: z.string().optional().default(""),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Explicitly control Secure cookie flag. Defaults to NODE_ENV=production.
  // Set to "false" for HTTP-only self-host, "true" behind TLS proxy.
  SESSION_COOKIE_SECURE: z.string().optional().default("auto"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function _resetConfigCache(): void {
  cached = null;
}

export function isGitHubOAuthEnabled(c: AppConfig = loadConfig()): boolean {
  return Boolean(c.GITHUB_CLIENT_ID && c.GITHUB_CLIENT_SECRET && c.GITHUB_REDIRECT_URI);
}

export function parseAllowedEmailDomains(c: AppConfig = loadConfig()): string[] {
  return c.OAUTH_ALLOWED_EMAIL_DOMAINS
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}