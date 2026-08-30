import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCsrfToken, issueSession } from "../src/auth/session.js";

function makeDb() {
  const campaigns = new Map<string, any>(), actions = new Map<string, any>(), audits: any[] = [], outbox: any[] = [], idempotency = new Set<string>();
  const db: any = {
    user: { findUnique: async ({ where }: any) => where.id === "creator-1" ? { id: "creator-1", role: "creator", tenantId: "tenant-1", communityId: "community-1", creator: { id: "creator-profile-1" } } : null, findFirst: async ({ where }: any) => where.id === "creator-1" ? { id: "creator-1", role: "creator", tenantId: "tenant-1", communityId: "community-1", creator: { id: "creator-profile-1" } } : null },
    campaign: { create: async ({ data }: any) => { const row = Object.assign({ id: "campaign-1" }, data); campaigns.set(row.id, row); return row; }, findFirst: async () => [...campaigns.values()][0] ?? null, findUnique: async ({ where }: any) => campaigns.get(where.id) ?? null, update: async ({ where, data }: any) => { const row = Object.assign({}, campaigns.get(where.id), data); campaigns.set(where.id, row); return row; } },
    campaignAction: { create: async ({ data }: any) => { const row = Object.assign({ id: `action-${actions.size + 1}` }, data); actions.set(row.id, row); return row; }, findFirst: async ({ where }: any) => actions.get(where.id) ?? null, update: async ({ where, data }: any) => { const row = Object.assign({}, actions.get(where.id), data); actions.set(row.id, row); return row; } },
    engagementEvent: { findMany: async ({ where }: any) => (where.id?.in ?? []).map((id: string) => ({ id, fanId: "fan-1", eventType: "mission.completed" })) }, consentGrant: { findFirst: async () => ({ status: "active" }) }, approval: { create: async ({ data }: any) => data },
    idempotencyRecord: { create: async ({ data }: any) => { const key = JSON.stringify(data); if (idempotency.has(key)) throw new Error("unique"); idempotency.add(key); return data; } }, auditEvent: { create: async ({ data }: any) => { audits.push(data); return data; } }, outboxJob: { create: async ({ data }: any) => { outbox.push(data); return data; } },
    $transaction: async (callback: (tx: any) => unknown) => callback(db), _state: { campaigns, actions, audits, outbox },
  };
  return db;
}

const origin = "fanloom-origin";
function headers(key: string) { const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret"); return { authorization: `Bearer ${token}`, origin, "x-csrf-token": createCsrfToken(token, origin, "test-secret"), "idempotency-key": key }; }

describe("campaign routes", () => {
  it("creates consent-evidence financial work behind approval", async () => {
    const db = makeDb(), app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: origin });
    expect((await app.inject({ method: "POST", url: "/v1/campaigns", headers: headers("campaign-create"), payload: { name: "Welcome", budgetLimitMinor: 1000 } })).statusCode).toBe(201);
    const action = await app.inject({ method: "POST", url: "/v1/campaigns/campaign-1/actions", headers: headers("action-create"), payload: { actionType: "reward", amountMinor: 100, maxSpendMinor: 100, evidenceEventIds: ["event-1"] } });
    expect(action.statusCode).toBe(202); expect(action.json()).toMatchObject({ status: "awaiting_approval", score: 5 }); expect(db._state.outbox).toEqual(expect.arrayContaining([expect.objectContaining({ topic: "campaign.action.proposed" })])); await app.close();
  });
  it("rejects execution until approval and rejects duplicate action keys", async () => {
    const db = makeDb(), app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: origin });
    await app.inject({ method: "POST", url: "/v1/campaigns", headers: headers("campaign-create"), payload: { name: "Welcome", budgetLimitMinor: 1000 } });
    await app.inject({ method: "POST", url: "/v1/campaigns/campaign-1/actions", headers: headers("action-create"), payload: { actionType: "reward", amountMinor: 100, maxSpendMinor: 100, evidenceEventIds: ["event-1"] } });
    expect((await app.inject({ method: "POST", url: "/v1/campaigns/campaign-1/actions/action-1/execute", headers: headers("execute-1") })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/v1/campaigns/campaign-1/actions", headers: headers("action-create"), payload: { actionType: "reward", amountMinor: 100, maxSpendMinor: 100, evidenceEventIds: ["event-1"] } })).statusCode).toBe(409); await app.close();
  });
});
