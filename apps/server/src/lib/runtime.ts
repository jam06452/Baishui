import { loadConfig, type AppConfig } from "./config.js";
import { getDb, ensureOwnerUser, runMigrations, type DbHandle } from "@baishui/db";
import { CryptoService } from "@baishui/crypto";
import { getRedis, type RedisClient } from "./redis.js";
import { UsageBuffer } from "./usage-buffer.js";
import { hash } from "@node-rs/argon2";
import { logger } from "./logger.js";

export interface Runtime {
  config: AppConfig;
  db: DbHandle;
  crypto: CryptoService;
  redis: RedisClient | null;
  usage: UsageBuffer;
}

export async function initRuntime(opts: { migrate?: boolean; bootstrap?: boolean } = {}): Promise<Runtime> {
  const config = loadConfig();
  logger.info({ role: config.ROLE, env: config.NODE_ENV }, "initializing runtime");

  const db = getDb(config.DATABASE_URL, {
    max: config.DB_POOL_MAX,
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
  });
  const crypto = CryptoService.fromEnv(config.PROXY_ENCRYPTION_ROOT_KEY);
  const redis = getRedis(config.REDIS_URL);
  const usage = new UsageBuffer(db.db, config.USAGE_FLUSH_MS, config.USAGE_FLUSH_BATCH);

  if (opts.migrate !== false) {
    await runMigrations(config.DATABASE_URL);
    logger.info("migrations applied");
  }

  // ponytail: wizard is the default first-user path. Env bootstrap only when
  // ALLOW_UNATTENDED_SETUP=1 (CI/Helm/headless installs). Otherwise the user
  // creates the owner via /api/setup (works only when no users exist).
  if (
    opts.bootstrap !== false &&
    config.ALLOW_UNATTENDED_SETUP === "1" &&
    config.ADMIN_EMAIL &&
    config.ADMIN_PASSWORD
  ) {
    let passwordHash: string | null = null;
    try {
      passwordHash = await hash(config.ADMIN_PASSWORD);
    } catch (err) {
      logger.warn({ err }, "argon2 unavailable; bootstrapping owner without password hash");
    }
    const created = await ensureOwnerUser(db.db, {
      email: config.ADMIN_EMAIL,
      passwordHash,
      name: "Owner",
    });
    logger.info(
      created ? { email: created.email, id: created.id } : {},
      created ? "bootstrap owner created (unattended)" : "owner already exists; skipping bootstrap",
    );
  }

  return { config, db, crypto, redis, usage };
}