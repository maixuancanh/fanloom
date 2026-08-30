import { describe, expect, it } from "vitest";
import { createPrismaOutboxStore, runWorkerOnce, type OutboxJob, type OutboxStore } from "../src/outbox.js";

function memoryStore(job: OutboxJob): OutboxStore & { job: OutboxJob } {
  return {
    job,
    async claim() { if (this.job.status !== "pending") return null; this.job.status = "processing"; this.job.attempts += 1; return this.job; },
    async ack() { this.job.status = "delivered"; },
    async retry() { this.job.status = this.job.attempts >= 2 ? "failed" : "pending"; },
    async status() { return this.job.status; },
  };
}

type FakeRow = OutboxJob & { availableAt: Date; lockedAt: Date | null; deliveredAt: Date | null; failedAt: Date | null; lastError: string | null; createdAt: Date };

function prismaHarness(row: FakeRow) {
  const state = { row };
  let transactionTail = Promise.resolve();
  const matches = (where: any) => {
    if (where.id && where.id !== row.id) return false;
    if (where.status && where.status !== row.status) return false;
    if (where.claimToken && where.claimToken !== row.claimToken) return false;
    if (where.lockedAt?.not === null && row.lockedAt === null) return false;
    if (where.lockedAt?.lt && !(row.lockedAt && row.lockedAt < where.lockedAt.lt)) return false;
    if (where.lockedAt?.gte && !(row.lockedAt && row.lockedAt >= where.lockedAt.gte)) return false;
    if (where.availableAt?.lte && !(row.availableAt <= where.availableAt.lte)) return false;
    if (where.OR && !where.OR.some((part: any) => matches(Object.assign({}, where, part, { OR: undefined })))) return false;
    return true;
  };
  const client = {
    $transaction: async (callback: (tx: typeof client) => unknown) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await callback(client); } finally { release(); }
    },
    outboxJob: {
      findFirst: async ({ where }: any) => matches(where) ? Object.assign({}, row) : null,
      findUnique: async ({ where, select }: any) => matches(where) ? Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]])) : null,
      updateMany: async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "object" && value !== null && "increment" in value) (row as any)[key] += (value as any).increment;
          else (row as any)[key] = value;
        }
        return { count: 1 };
      },
    },
  };
  return { state, client };
}

describe("worker outbox lifecycle", () => {
  it("claims, handles, and acknowledges exactly once", async () => {
    const store = memoryStore({ id: "job-1", tenantId: "tenant-1", communityId: "community-1", topic: "engagement.evaluate", payload: {}, attempts: 0, status: "pending", claimToken: "memory-token-1" });
    let handled = 0;
    expect(await runWorkerOnce(store, { "engagement.evaluate": async () => { handled += 1; } })).toBe(true);
    expect(handled).toBe(1);
    expect(await store.status("job-1")).toBe("delivered");
    expect(await runWorkerOnce(store, { "engagement.evaluate": async () => { handled += 1; } })).toBe(false);
    expect(handled).toBe(1);
  });

  it("preserves tenant and community scope when claiming a Prisma job", async () => {
    const t0 = new Date("2026-08-27T00:00:00.000Z");
    const { client } = prismaHarness({ id: "job-scope", tenantId: "tenant-1", communityId: "community-1", topic: "creator.advisor.evaluate", payload: { creatorId: "creator-1", eventIds: ["event-1"] }, attempts: 0, status: "pending", claimToken: null as unknown as string, availableAt: t0, lockedAt: null, deliveredAt: null, failedAt: null, lastError: null, createdAt: t0 } as unknown as FakeRow);
    const claimed = await createPrismaOutboxStore(client).claim(t0);
    expect(claimed).toMatchObject({ tenantId: "tenant-1", communityId: "community-1" });
  });

  it("retries failures and exposes an exhausted failed status", async () => {
    const store = memoryStore({ id: "job-2", tenantId: "tenant-1", communityId: "community-1", topic: "missing", payload: {}, attempts: 0, status: "pending", claimToken: "memory-token-2" });
    await runWorkerOnce(store, {});
    expect(await store.status("job-2")).toBe("pending");
    await runWorkerOnce(store, {});
    expect(await store.status("job-2")).toBe("failed");
  });

  it("prevents a stale worker from acknowledging or retrying a reclaimed lease", async () => {
    const t0 = new Date("2026-08-25T00:00:00.000Z");
    const { state, client } = prismaHarness({ id: "job-3", tenantId: "tenant-1", communityId: "community-1", topic: "engagement.evaluate", payload: {}, attempts: 0, status: "pending", availableAt: t0, lockedAt: null, deliveredAt: null, failedAt: null, lastError: null, createdAt: t0 });
    const store = createPrismaOutboxStore(client, { leaseMs: 1_000, backoffMs: 0 });

    const first = await store.claim(t0);
    expect(first?.claimToken).toEqual(expect.any(String));
    const second = await store.claim(new Date(t0.getTime() + 1_001));
    expect(second?.claimToken).toEqual(expect.any(String));
    expect(second?.claimToken).not.toBe(first?.claimToken);

    await store.ack(first!.id, first!.claimToken, new Date(t0.getTime() + 1_001));
    expect(state.row.status).toBe("processing");
    await store.retry(first!.id, first!.claimToken, "stale failure", new Date(t0.getTime() + 1_001));
    expect(state.row.status).toBe("processing");
    expect(state.row.lastError).toBeNull();

    await store.ack(second!.id, second!.claimToken, new Date(t0.getTime() + 1_001));
    expect(state.row.status).toBe("delivered");
  });

  it("allows only one owner when workers claim concurrently", async () => {
    const t0 = new Date("2026-08-25T00:00:00.000Z");
    const { state, client } = prismaHarness({ id: "job-4", tenantId: "tenant-1", communityId: "community-1", topic: "engagement.evaluate", payload: {}, attempts: 0, status: "pending", claimToken: null as unknown as string, availableAt: t0, lockedAt: null, deliveredAt: null, failedAt: null, lastError: null, createdAt: t0 });
    const storeA = createPrismaOutboxStore(client);
    const storeB = createPrismaOutboxStore(client);

    const [claimA, claimB] = await Promise.all([storeA.claim(t0), storeB.claim(t0)]);
    expect([claimA, claimB].filter(Boolean)).toHaveLength(1);
    expect(state.row.attempts).toBe(1);
    expect(state.row.status).toBe("processing");
  });
});
