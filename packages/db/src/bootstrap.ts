import { users } from "./schema/index.js";
import type { Db } from "./client.js";

/** Insert the bootstrap owner if no users exist. Idempotent. Returns created user or null. */
export async function ensureOwnerUser(
  db: Db,
  input: { email: string; passwordHash: string | null; name?: string },
) {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return null;

  const [created] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name ?? null,
      passwordHash: input.passwordHash,
      role: "owner",
      emailVerifiedAt: new Date(),
      forcePasswordChange: true,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  return created ?? null;
}