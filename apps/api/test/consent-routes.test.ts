import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCsrfToken, issueSession } from "../src/auth/session.js";

function makeDb() {
  const users = new Map([
    ["fan-1", { id: "fan-1", role: "fan", fan: { id: "profile-fan-1", handle: "alice", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-profile-1" }, creator: null, tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-profile-1" }],
    ["fan-2", { id: "fan-2", role: "fan", fan: { id: "profile-fan-2", handle: "bob", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-profile-1" }, creator: null, tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-profile-1" }],
    ["creator-1", { id: "creator-1", role: "creator", fan: null, creator: { id: "creator-profile-1" }, tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-profile-1" }],
    ["moderator-1", { id: "moderator-1", role: "admin", fan: null, creator: null, tenantId: "tenant-1", communityId: "community-1", creatorId: null }],
  ]);
  const consents = new Map<string, { status: "active" | "revoked"; fanId: string; purpose: string; tenantId?: string }>();
  const audit: unknown[] = [];
  const outbox: unknown[] = [];
  const idempotency: unknown[] = [];
  const database = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    fan: { findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
      if (where.userId) return [...users.values()].find((user) => user.id === where.userId)?.fan ?? null;
      return [...users.values()].find((user) => user.fan?.id === where.id)?.fan ?? null;
    } },
    consentGrant: {
      upsert: async ({ where, create, update }: any) => {
        const scope = where.tenantId_fanId_purpose ?? where.fanId_purpose;
        const key = `${scope.fanId}:${scope.purpose}`;
        const value = Object.assign({}, consents.get(key), create, update);
        consents.set(key, value);
        return value;
      },
      findUnique: async ({ where }: any) => { const key = where.tenantId_fanId_purpose ?? where.fanId_purpose; return consents.get(`${key.fanId}:${key.purpose}`) ?? null; },
      findMany: async ({ where }: any) => [...consents.values()].filter((value) => value.fanId === where.fanId && (!where.tenantId || value.tenantId === where.tenantId)),
    },
    idempotencyRecord: { create: async ({ data }: any) => {
      if (!data.communityId || !data.operation || !data.resource) throw new Error("missing idempotency scope");
      const duplicate = idempotency.some((record: any) => ["tenantId", "communityId", "actorId", "callerKey", "operation", "resource"].every((field) => record[field] === data[field]));
      if (duplicate) throw new Error("unique");
      idempotency.push(data);
      return data;
    } },
    auditEvent: { create: async ({ data }: any) => { audit.push(data); return data; } },
    outboxJob: { create: async ({ data }: any) => { outbox.push(data); return data; } },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(database),
    _state: { consents, audit, outbox, idempotency },
  };
  return database;
}

const origin = new URL("https:" + "//fanloom.test").toString();
const headers = (userId: string, role: "fan" | "creator" | "moderator", key = `${userId}-key`, tenantId = "tenant-1") => {
  const authorization = `Bearer ${issueSession({ userId, role, tenantId }, "test-secret")}`;
  const token = authorization.slice(7);
  return {
  authorization,
  origin,
  "x-csrf-token": createCsrfToken(token, origin, "test-secret"),
  "idempotency-key": key,
};
};

describe("Fanloom authenticated consent controls", () => {
  it("rejects unauthenticated and cross-role access", async () => {
    const app = buildApp({ db: makeDb(), sessionSecret: "test-secret", allowedOrigin: origin });
    expect((await app.inject({ method: "GET", url: "/v1/me/export" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: headers("creator-1", "creator") })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: headers("creator-1", "creator", "creator-grant") })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/v1/me/consent/personalization", headers: headers("creator-1", "creator", "creator-revoke") })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/me/delete-request", headers: headers("creator-1", "creator", "creator-delete") })).statusCode).toBe(403);
    await app.close();
  });

  it("denies cross-tenant sessions and keeps cross-account exports self-scoped", async () => {
    const app = buildApp({ db: makeDb(), sessionSecret: "test-secret", allowedOrigin: origin });
    const crossTenant = await app.inject({ method: "GET", url: "/v1/me/export", headers: headers("fan-1", "fan", "cross-tenant", "tenant-2") });
    expect(crossTenant.statusCode).toBe(401);
    const otherAccount = await app.inject({ method: "GET", url: "/v1/me/export", headers: headers("fan-2", "fan") });
    expect(otherAccount.statusCode).toBe(200);
    expect(otherAccount.json().fan).toMatchObject({ id: "profile-fan-2", handle: "bob" });
    expect(JSON.stringify(otherAccount.json())).not.toContain("profile-fan-1");
    await app.close();
  });

  it("rejects tampered, expired, and malformed session tokens", async () => {
    const app = buildApp({ db: makeDb(), sessionSecret: "test-secret", allowedOrigin: origin });
    const valid = headers("fan-1", "fan");
    const validToken = valid.authorization.slice(7);
    const [validBody, validSignature] = validToken.split(".");
    const tamperedBody = `${validBody[0] === "A" ? "B" : "A"}${validBody.slice(1)}`;
    const tampered = Object.assign({}, valid, { authorization: `Bearer ${tamperedBody}.${validSignature}` });
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: tampered })).statusCode).toBe(401);
    const expiredToken = issueSession({ userId: "fan-1", role: "fan", tenantId: "tenant-1", expiresAt: Date.now() - 1 }, "test-secret");
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: { authorization: `Bearer ${expiredToken}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: { authorization: "Bearer not-a-session" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: { authorization: `Bearer ${validToken}.extra` } })).statusCode).toBe(401);
    await app.close();
  });

  it("grants, revokes, excludes personalization immediately, and emits one transactional outbox event", async () => {
    const db = makeDb();
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: origin });
    const fanHeaders = headers("fan-1", "fan");
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: Object.assign({}, fanHeaders, { "idempotency-key": "grant-personalization" }) })).statusCode).toBe(204);
    const revoked = await app.inject({ method: "DELETE", url: "/v1/me/consent/personalization", headers: Object.assign({}, fanHeaders, { "idempotency-key": "revoke-personalization" }) });
    expect(revoked.statusCode).toBe(204);
    expect(db._state.consents.get("profile-fan-1:personalization")?.status).toBe("revoked");
    expect(db._state.outbox).toHaveLength(1);
    expect(db._state.outbox[0]).toMatchObject({ topic: "consent.revoked" });
    await app.close();
  });

  it("supports export and delete request, while blocking revoked consent replay", async () => {
    const db = makeDb();
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: origin });
    const fanHeaders = headers("fan-1", "fan");
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: Object.assign({}, fanHeaders, { "idempotency-key": "grant-1" }) })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: fanHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/me/delete-request", headers: Object.assign({}, fanHeaders, { "idempotency-key": "delete-1" }) })).statusCode).toBe(202);
    expect((await app.inject({ method: "DELETE", url: "/v1/me/consent/personalization", headers: Object.assign({}, fanHeaders, { "idempotency-key": "revoke-1" }) })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: Object.assign({}, fanHeaders, { "idempotency-key": "grant-2" }) })).statusCode).toBe(409);
    await app.close();
  });

  it("requires same-origin CSRF protection and rejects replayed idempotency keys", async () => {
    const db = makeDb();
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: origin });
    const missingCsrf = { authorization: headers("fan-1", "fan").authorization, origin, "idempotency-key": "missing-csrf" };
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: missingCsrf })).statusCode).toBe(403);
    const wrongOrigin = headers("fan-1", "fan", "wrong-origin");
    wrongOrigin.origin = new URL("https:" + "//attacker.test").toString();
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: wrongOrigin })).statusCode).toBe(403);
    const fanHeaders = Object.assign({}, headers("fan-1", "fan"), { "idempotency-key": "grant-1" });
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: fanHeaders })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: fanHeaders })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: Object.assign({}, headers("fan-1", "fan", "stable-missing"), { "x-csrf-token": "csrf-test" }) })).statusCode).toBe(403);
    const missingKey = headers("fan-1", "fan");
    delete (missingKey as Record<string, string>)["idempotency-key"];
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/analytics", headers: missingKey })).statusCode).toBe(400);
    await app.close();
  });

  it("scopes caller keys by community, operation, and resource", async () => {
    const db = makeDb();
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: origin });
    const fanHeaders = Object.assign({}, headers("fan-1", "fan"), { "idempotency-key": "same-caller-key" });
    expect((await app.inject({ method: "POST", url: "/v1/me/consent/personalization", headers: fanHeaders })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/v1/me/consent/personalization", headers: fanHeaders })).statusCode).toBe(204);
    expect(db._state.idempotency).toEqual(expect.arrayContaining([
      expect.objectContaining({ callerKey: "same-caller-key", operation: "consent.grant", resource: "personalization", communityId: "community-1" }),
      expect.objectContaining({ callerKey: "same-caller-key", operation: "consent.revoke", resource: "personalization", communityId: "community-1" }),
    ]));
    await app.close();
  });

  it("allows a moderator without a fan profile to use moderator export", async () => {
    const app = buildApp({ db: makeDb(), sessionSecret: "test-secret", allowedOrigin: origin });
    expect((await app.inject({ method: "GET", url: "/v1/me/export", headers: headers("moderator-1", "moderator") })).statusCode).toBe(200);
    await app.close();
  });
});
