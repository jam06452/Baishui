import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  bigint,
  bigserial,
  jsonb,
  pgEnum,
  primaryKey,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Enum values live here (not in a shared package) — db is their only consumer.
// Phase 1+ may extract to a shared package when a second consumer appears.
const USER_ROLES = ["owner", "admin", "member", "viewer"] as const;
const PROVIDER_TYPES = [
  "openai_compatible", "openai", "anthropic", "google", "mistral",
  "together", "groq", "fireworks", "deepseek", "azure_openai",
  "cohere", "bedrock", "custom",
] as const;
const PROVIDER_KEY_STATUS = ["active", "disabled", "exhausted", "revoked"] as const;
const CIRCUIT_STATES = ["closed", "open", "half_open"] as const;

type UserRole = (typeof USER_ROLES)[number];
type ProviderType = (typeof PROVIDER_TYPES)[number];
type ProviderKeyStatus = (typeof PROVIDER_KEY_STATUS)[number];
type CircuitState = (typeof CIRCUIT_STATES)[number];
type Modality = "text" | "image" | "audio" | "video" | "embed";
type ApiKeyScope = "chat" | "models" | "embeddings" | "admin";

// ── enums ──────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const providerTypeEnum = pgEnum("provider_type", PROVIDER_TYPES);
export const providerKeyStatusEnum = pgEnum("provider_key_status", PROVIDER_KEY_STATUS);
export const circuitStateEnum = pgEnum("circuit_state", CIRCUIT_STATES);

// ── users ──────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").$type<UserRole>().notNull().default("member"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  forcePasswordChange: boolean("force_password_change").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ── sessions (Lucia-style DB sessions) ─────────────────────────
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  isRefresh: boolean("is_refresh").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ── OAuth account linking ──────────────────────────────────────
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tokenUpdatedAt: timestamp("token_updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("oauth_provider_user_unique").on(t.provider, t.providerUserId)],
);
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type NewOauthAccount = typeof oauthAccounts.$inferInsert;

// ── user-facing proxy API keys (hash only) ─────────────────────
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  name: text("name"),
  scopes: text("scopes")
    .array()
    .$type<ApiKeyScope[]>()
    .notNull()
    .default(["chat", "models"]),
  // ponytail: per-key custom limits. null = use server default / unlimited.
  rateLimitRpm: integer("rate_limit_rpm"),
  tokenLimitDaily: bigint("token_limit_daily", { mode: "number" }),
  costLimitDaily: numeric("cost_limit_daily", { precision: 12, scale: 4 }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

// ── management API keys (for automation/scripts) ──────────────
export const managementKeys = pgTable(
  "management_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    name: text("name").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(["keys"]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
export type ManagementKey = typeof managementKeys.$inferSelect;
export type NewManagementKey = typeof managementKeys.$inferInsert;

// ── providers (org-level shared pool) ──────────────────────────
export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: providerTypeEnum("type").$type<ProviderType>().notNull(),
  baseUrl: text("base_url"),
  adapter: text("adapter"),
  enabled: boolean("enabled").notNull().default(true),
  metadata: text("metadata"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;

// ── provider keys (encrypted at rest) ──────────────────────────
export const providerKeys = pgTable("provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  secretEnc: text("secret_enc").notNull(),
  secretKid: text("secret_kid").notNull(),
  status: providerKeyStatusEnum("status")
    .$type<ProviderKeyStatus>()
    .notNull()
    .default("active"),
  dailyQuotaUsd: numeric("daily_quota_usd", { precision: 12, scale: 4 }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
});
export type ProviderKey = typeof providerKeys.$inferSelect;
export type NewProviderKey = typeof providerKeys.$inferInsert;

// ── provider key health (durable circuit-breaker state) ───────
export const providerKeyHealth = pgTable(
  "provider_key_health",
  {
    providerKeyId: uuid("provider_key_id")
      .notNull()
      .references(() => providerKeys.id, { onDelete: "cascade" }),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    circuitState: circuitStateEnum("circuit_state")
      .$type<CircuitState>()
      .notNull()
      .default("closed"),
    circuitOpenedAt: timestamp("circuit_opened_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.providerKeyId] })],
);
export type ProviderKeyHealth = typeof providerKeyHealth.$inferSelect;
export type NewProviderKeyHealth = typeof providerKeyHealth.$inferInsert;

// ── models (auto-discovered per provider) ──────────────────────
export const models = pgTable("models", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  upstreamId: text("upstream_id").notNull(),
  displayName: text("display_name").notNull(),
  contextWindow: integer("context_window"),
  inputPricePer1m: numeric("input_price_per_1m", { precision: 12, scale: 6 }),
  outputPricePer1m: numeric("output_price_per_1m", { precision: 12, scale: 6 }),
  modalities: text("modalities").array().$type<Modality[]>(),
  compatTags: text("compat_tags").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;

// ── routing rules with fallback chains ────────────────────────
export interface FallbackChainEntry {
  modelId: string;
  priority: number;
}
export const routingRules = pgTable("routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  alias: text("alias").notNull().unique(),
  primaryModelId: uuid("primary_model_id")
    .notNull()
    .references(() => models.id, { onDelete: "cascade" }),
  fallbackChain: jsonb("fallback_chain").$type<FallbackChainEntry[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type RoutingRule = typeof routingRules.$inferSelect;
export type NewRoutingRule = typeof routingRules.$inferInsert;

// ── request logs (planned: monthly RANGE partition by created_at) ─
export const requestLogs = pgTable(
  "request_logs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    providerId: uuid("provider_id").references(() => providers.id, { onDelete: "set null" }),
    providerKeyId: uuid("provider_key_id").references(() => providerKeys.id, {
      onDelete: "set null",
    }),
    modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    servedByModelId: uuid("served_by_model_id").references(() => models.id, {
      onDelete: "set null",
    }),
    status: integer("status"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costEstimate: numeric("cost_estimate", { precision: 14, scale: 6 }),
    errorCode: text("error_code"),
    errorMsg: text("error_msg"),
    stream: boolean("stream").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("request_logs_created_at_brin").using("brin", t.createdAt),
    index("request_logs_user_created_idx").on(t.userId, t.createdAt),
    index("request_logs_model_created_idx").on(t.modelId, t.createdAt),
    index("request_logs_provider_created_idx").on(t.providerId, t.createdAt),
    index("request_logs_errors_idx").on(t.status).where(sql`${t.status} >= 400`),
  ],
);
export type RequestLog = typeof requestLogs.$inferSelect;
export type NewRequestLog = typeof requestLogs.$inferInsert;

// ── usage rollups (near-real-time, ~1 min) ────────────────────
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const usageRollups = pgTable(
  "usage_rollups",
  {
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    granularity: text("granularity").notNull(),
    userId: uuid("user_id").notNull().default(NIL_UUID),
    providerId: uuid("provider_id").notNull().default(NIL_UUID),
    modelId: uuid("model_id").notNull().default(NIL_UUID),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cost: numeric("cost", { precision: 16, scale: 6 }).notNull().default("0"),
    errors: bigint("errors", { mode: "number" }).notNull().default(0),
    p50LatencyMs: integer("p50_latency_ms"),
    p95LatencyMs: integer("p95_latency_ms"),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.granularity, t.userId, t.providerId, t.modelId] }),
    index("usage_rollups_gran_bucket_idx").on(t.granularity, t.bucket),
    index("usage_rollups_user_bucket_idx").on(t.userId, t.bucket),
    index("usage_rollups_model_bucket_idx").on(t.modelId, t.bucket),
  ],
);
export type UsageRollup = typeof usageRollups.$inferSelect;
export type NewUsageRollup = typeof usageRollups.$inferInsert;

// ── audit log ──────────────────────────────────────────────────
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_actor_created_idx").on(t.actorUserId, t.createdAt),
    index("audit_log_action_created_idx").on(t.action, t.createdAt),
  ],
);
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// ── model sync jobs ────────────────────────────────────────────
export const modelSyncJobs = pgTable(
  "model_sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    modelsAdded: integer("models_added").notNull().default(0),
    modelsUpdated: integer("models_updated").notNull().default(0),
    modelsRemoved: integer("models_removed").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("model_sync_jobs_provider_created_idx").on(t.providerId, t.createdAt)],
);
export type ModelSyncJob = typeof modelSyncJobs.$inferSelect;
export type NewModelSyncJob = typeof modelSyncJobs.$inferInsert;