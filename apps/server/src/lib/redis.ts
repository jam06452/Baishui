import Redis from "ioredis";

export type RedisClient = Redis;

let client: Redis | null = null;

export function getRedis(url?: string): Redis | null {
  if (client) return client;
  const conn = url ?? process.env.REDIS_URL;
  if (!conn) return null;
  client = new Redis(conn, {
    maxRetriesPerRequest: 3,
    retryStrategy: (t) => Math.min(t * 200, 2000),
  });
  client.on("error", () => {});
  return client;
}