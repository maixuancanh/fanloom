import { randomUUID } from "node:crypto";

export type OutboxStatus = "pending" | "processing" | "delivered" | "failed";
export type OutboxJob = { id: string; tenantId: string; communityId: string; topic: string; payload: Record<string, unknown>; attempts: number; status: OutboxStatus; claimToken: string };

export type OutboxStore = {
  claim(now: Date): Promise<OutboxJob | null>;
  ack(id: string, claimToken: string, now?: Date): Promise<void>;
  retry(id: string, claimToken: string, error: string, now?: Date): Promise<void>;
  status(id: string): Promise<OutboxStatus | null>;
};

export function createPrismaOutboxStore(db: any, options: { leaseMs?: number; maxAttempts?: number; backoffMs?: number } = {}): OutboxStore {
  const leaseMs = options.leaseMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const backoffMs = options.backoffMs ?? 1_000;
  return {
    async claim(now) {
      return db.$transaction(async (tx: any) => {
        const stale = new Date(now.getTime() - leaseMs);
        const candidate = await tx.outboxJob.findFirst({
          where: { availableAt: { lte: now }, OR: [{ status: "pending" }, { status: "processing", lockedAt: { lt: stale } }] },
          orderBy: { createdAt: "asc" },
        });
        if (!candidate) return null;
        const claimed = await tx.outboxJob.updateMany({
          where: { id: candidate.id, OR: [{ status: "pending" }, { status: "processing", lockedAt: { lt: stale } }] },
          data: { status: "processing", attempts: { increment: 1 }, lockedAt: now, claimToken: randomUUID(), lastError: null },
        });
        if (claimed.count !== 1) return null;
        return tx.outboxJob.findUnique({ where: { id: candidate.id }, select: { id: true, tenantId: true, communityId: true, topic: true, payload: true, attempts: true, status: true, claimToken: true } });
      });
    },
    async ack(id, claimToken, now = new Date()) {
      const lease = new Date(now.getTime() - leaseMs);
      await db.outboxJob.updateMany({ where: { id, status: "processing", claimToken, lockedAt: { not: null, gte: lease } }, data: { status: "delivered", deliveredAt: now, lockedAt: null, lastError: null } });
    },
    async retry(id, claimToken, error, now = new Date()) {
      const lease = new Date(now.getTime() - leaseMs);
      const job = await db.outboxJob.findUnique({ where: { id, status: "processing", claimToken, lockedAt: { not: null, gte: lease } }, select: { attempts: true } });
      const exhausted = !job || job.attempts >= maxAttempts;
      if (!job) return;
      await db.outboxJob.updateMany({ where: { id, status: "processing", claimToken, lockedAt: { not: null, gte: lease } }, data: exhausted
        ? { status: "failed", failedAt: now, lockedAt: null, lastError: error }
        : { status: "pending", availableAt: new Date(now.getTime() + backoffMs * 2 ** Math.max(0, job.attempts - 1)), lockedAt: null, lastError: error } });
    },
    async status(id) {
      const job = await db.outboxJob.findUnique({ where: { id }, select: { status: true } });
      return job?.status ?? null;
    },
  };
}

export async function runWorkerOnce(store: OutboxStore, handlers: Record<string, (job: OutboxJob) => Promise<void>>, now = new Date()): Promise<boolean> {
  const job = await store.claim(now);
  if (!job) return false;
  try {
    const handler = handlers[job.topic];
    if (!handler) throw new Error(`outbox_handler_missing:${job.topic}`);
    await handler(job);
    await store.ack(job.id, job.claimToken, now);
    if (process.env.NODE_ENV !== "test") {
      console.info("fanloom_worker_job_delivered", { jobId: job.id, topic: job.topic, attempts: job.attempts });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "outbox_job_failed";
    if (process.env.NODE_ENV !== "test") {
      console.error("fanloom_worker_job_failed", { jobId: job.id, topic: job.topic, attempts: job.attempts, message });
    }
    await store.retry(job.id, job.claimToken, message, now);
  }
  return true;
}

export async function runWorker(input: { store: OutboxStore; handlers: Record<string, (job: OutboxJob) => Promise<void>>; signal?: AbortSignal; pollMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  while (!input.signal?.aborted) {
    const worked = await runWorkerOnce(input.store, input.handlers);
    if (!worked) await sleep(input.pollMs ?? 1_000);
  }
}
