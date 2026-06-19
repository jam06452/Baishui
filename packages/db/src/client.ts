import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function getDb(databaseUrl?: string, opts: { max?: number; statementTimeoutMs?: number } = {}): DbHandle {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? Number(process.env.DB_POOL_MAX) ?? 50,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // ponytail: per-statement timeout prevents runaway queries from starving the pool under load.
    application_name: "baishui",
  });
  if (opts.statementTimeoutMs) {
    pool.on("connect", (client) => {
      client.query(`SET statement_timeout = ${opts.statementTimeoutMs}`).catch(() => {});
    });
  }
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export { schema };