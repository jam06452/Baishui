import { requestLogs } from "@baishui/db";
import type { Db } from "@baishui/db";
import { logger } from "./logger.js";

// ponytail: batch usage-log writes. Single-row INSERT per request = ~5-10 DB
// round-trips/sec at high RPS. Batched multi-row INSERT every 1s = 1 write/sec.
// Bounds memory: if more than MAX_QUEUE rows pending, drop oldest (better to
// lose analytics than block requests).

interface UsageRow {
  userId: string | null;
  providerId: string | null;
  providerKeyId: string | null;
  modelId: string | null;
  apiKeyId: string | null;
  servedByModelId: string | null;
  status: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimate: string | null;
  errorCode: string | null;
  errorMsg: string | null;
  stream: boolean;
  createdAt: Date;
}

const MAX_QUEUE = 5000;

export class UsageBuffer {
  private queue: UsageRow[] = [];
  private flushing = false;
  private droppedCount = 0;
  private readonly flushTimer: NodeJS.Timeout;
  private lastFlushAt = Date.now();
  private totalWritten = 0;
  private totalFlushes = 0;

  constructor(
    private db: Db,
    flushMs: number,
    private flushBatch: number,
  ) {
    // ponytail: setInterval — pg-boss is overkill here; this is local state.
    this.flushTimer = setInterval(() => { void this.flush(); }, flushMs);
    // Allow the process to exit even if the timer is still running
    this.flushTimer.unref?.();
  }

  append(row: Omit<UsageRow, "createdAt">): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.droppedCount++;
      // ponytail: drop analytics when overflowing; never block proxy traffic.
      if (this.droppedCount % 1000 === 1) {
        logger.warn({ dropped: this.droppedCount, queued: this.queue.length }, "usage buffer overflow — dropping");
      }
      return;
    }
    this.queue.push({ ...row, createdAt: new Date() });
    if (this.queue.length >= this.flushBatch) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, Math.min(this.flushBatch, this.queue.length));
    try {
      // Drizzle multi-row insert: one INSERT with N parameter tuples. Batching
      // 500 rows is a single round-trip — proves out at the throughput test.
      await this.db.insert(requestLogs).values(batch);
      this.totalWritten += batch.length;
      this.totalFlushes++;
      this.lastFlushAt = Date.now();
    } catch (err) {
      logger.warn({ err, count: batch.length }, "usage batch flush failed — dropping batch (analytics, not request-relevant)");
      // ponytail: don't requeue on failure — could cascade forever. Drop the batch.
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    clearInterval(this.flushTimer);
    // final flush — drain on shutdown to avoid losing recent usage
    await this.flush();
  }

  stats() {
    return {
      queued: this.queue.length,
      dropped: this.droppedCount,
      totalWritten: this.totalWritten,
      totalFlushes: this.totalFlushes,
      lastFlushAgoMs: Date.now() - this.lastFlushAt,
    };
  }
}