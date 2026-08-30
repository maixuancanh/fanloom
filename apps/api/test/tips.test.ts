import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCsrfToken, issueSession } from "../src/auth/session.js";

function headers(key: string) { const token = issueSession({ userId: "fan-1", role: "fan", tenantId: "tenant-1" }, "test-secret"); return { authorization: `Bearer ${token}`, origin: "fanloom-origin", "x-csrf-token": createCsrfToken(token, "fanloom-origin", "test-secret"), "idempotency-key": key }; }

function makeDb() {
  const tips = new Map<string, any>();
  const db: any = {
    user: { findFirst: async () => ({ id: "fan-1", role: "fan", tenantId: "tenant-1" }) },
    fan: { findFirst: async () => ({ id: "fan-profile-1", userId: "fan-1", creatorId: "creator-1", tenantId: "tenant-1", communityId: "community-1" }) },
    tip: { findUnique: async ({ where }: any) => Array.from(tips.values()).find((tip) => tip.idempotencyKey === where.idempotencyKey) ?? null, create: async ({ data }: any) => { const tip = Object.assign({ id: "tip-1" }, data); tips.set(tip.id, tip); return tip; } },
    outboxJob: { create: async ({ data }: any) => data },
    $transaction: async (callback: (tx: any) => unknown) => callback(db),
  };
  return db;
}

describe("tip routes", () => {
  it("returns the original pending tip on a duplicate idempotency key", async () => {
    const db = makeDb(), app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin" });
    const first = await app.inject({ method: "POST", url: "/v1/tips", headers: headers("tip-key"), payload: { creatorId: "creator-1", amountMinor: 250, currency: "USDC" } });
    const second = await app.inject({ method: "POST", url: "/v1/tips", headers: headers("tip-key"), payload: { creatorId: "creator-1", amountMinor: 250, currency: "USDC" } });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    await app.close();
  });
});
