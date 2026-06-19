import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "..", "drizzle");

/**
 * Apply pending SQL migrations from packages/db/drizzle against the given DB.
 * Safe to call on every boot (drizzle tracks applied migrations in the
 * `__drizzle_migrations` table).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}