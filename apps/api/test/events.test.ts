import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { legacyEngagementEventFingerprint } from "../../../packages/connectors/src/channels/webhook.js";

const secret = "provider-secret";
const provider = "community-webhook";
const timestamp = Math.floor(Date.now() / 1000);

function sign(rawBody: string, at = timestamp): string {
  return createHmac("sha256", secret).update(`${at}.${rawBody}`).digest("hex");
}

function makeDb(consentStatus: "active" | "revoked" | null = "active") {
  const events: any[] = [];
  const outbox: any[] = [];
  const database: any = {
    engagementEvent: {
      create: async ({ data }: any) => {
        if (events.some((event) => event.tenantId === data.tenantId && event.provider === data.provider && event.providerEventId === data.providerEventId)) throw new Error("unique provider event");
        const stored = Object.assign({ id: `event-${events.length + 1}` }, data);
        events.push(stored);
        return stored;
      },
      findUnique: async ({ where }: any) => events.find((event) => event.tenantId === where.tenantId_provider_providerEventId.tenantId && event.provider === where.tenantId_provider_providerEventId.provider && event.providerEventId === where.tenantId_provider_providerEventId.providerEventId) ?? null,
    },
    outboxJob: {
      create: async ({ data }: any) => { outbox.push(data); return data; },
    },
    fan: {
      findFirst: async () => consentStatus === null ? null : { id: "fan-1", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1" },
    },
    consentGrant: {
      findFirst: async () => consentStatus === null ? null : { status: consentStatus, purpose: "personalization", revokedAt: consentStatus === "revoked" ? new Date() : null },
    },
    $transaction: async (callback: (tx: typeof database) => unknown) => callback(database),
    _state: { events, outbox },
  };
  return database;
}

async function postEvent(app: ReturnType<typeof buildApp>, body: Record<string, unknown>, at = timestamp) {
  const rawBody = JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: "/v1/events",
    payload: rawBody,
    headers: {
      "content-type": "application/json",
      "x-fanloom-provider": provider,
      "x-fanloom-tenant": "tenant-1",
      "x-fanloom-community": "community-1",
      "x-fanloom-timestamp": String(at),
      "x-fanloom-signature": sign(rawBody, at),
    },
  });
}

const baseEvent = { providerEventId: "evt-1", kind: "comment.created", creatorId: "creator-1", fanId: "fan-1", occurredAt: new Date().toISOString(), payload: { text: "hello" } };

describe("engagement event ingestion", () => {
  it("stores a provider event once and creates one evaluation outbox job", async () => {
    const db = makeDb();
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    expect((await postEvent(app, baseEvent)).statusCode).toBe(202);
    expect((await postEvent(app, baseEvent)).statusCode).toBe(200);
    expect(db._state.events).toHaveLength(1);
    expect(db._state.outbox).toHaveLength(1);
    expect(db._state.outbox[0]).toMatchObject({ topic: "engagement.evaluate", idempotencyKey: `tenant-1:${provider}:evt-1` });
    await app.close();
  });

  it("rejects a legacy fingerprint with explicit remediation instead of silently treating it as canonical", async () => {
    const db = makeDb();
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    db._state.events.push({ id: "legacy-event", tenantId: "tenant-1", provider, providerEventId: "evt-1", fingerprint: legacyEngagementEventFingerprint({ provider, providerEventId: "evt-1", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1", fanId: "fan-1", kind: "comment.created", occurredAt: new Date(baseEvent.occurredAt as string), payload: {} }) });
    const response = await postEvent(app, baseEvent);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "legacy_fingerprint_requires_remediation", remediation: expect.any(String) });
    expect(db._state.outbox).toHaveLength(0);
    await app.close();
  });

  it("returns 401 for an invalid signature and does not touch persistence", async () => {
    const db = makeDb();
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    const response = await app.inject({ method: "POST", url: "/v1/events", payload: JSON.stringify(baseEvent), headers: { "content-type": "application/json", "x-fanloom-provider": provider, "x-fanloom-timestamp": String(timestamp), "x-fanloom-signature": "00" } });
    expect(response.statusCode).toBe(401);
    expect(db._state.events).toHaveLength(0);
    await app.close();
  });

  it("rejects stale and future webhook timestamps", async () => {
    const db = makeDb();
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } }, eventTimestampToleranceSeconds: 300 });
    expect((await postEvent(app, baseEvent, timestamp - 301)).statusCode).toBe(401);
    expect((await postEvent(app, baseEvent, timestamp + 301)).statusCode).toBe(401);
    await app.close();
  });

  it("stores the event but excludes the fan from evaluation without active personalization consent", async () => {
    const db = makeDb(null);
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    expect((await postEvent(app, baseEvent)).statusCode).toBe(202);
    expect(db._state.events[0]).toMatchObject({ eventType: "comment.created", tenantId: "tenant-1", communityId: "community-1" });
    expect(db._state.outbox[0].payload).toMatchObject({ eventId: expect.any(String), personalizationEligible: false });
    expect(db._state.outbox[0].payload).not.toHaveProperty("fanId");
    await app.close();
  });

  it("rejects unsupported event kinds", async () => {
    const app = buildApp({ db: makeDb(), eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    expect((await postEvent(app, Object.assign({}, baseEvent, { kind: "message.deleted" }))).statusCode).toBe(400);
    await app.close();
  });

  it("rejects missing provider scope binding", async () => {
    const app = buildApp({ db: makeDb(), eventProviderSecrets: { [provider]: secret } });
    expect((await postEvent(app, baseEvent)).statusCode).toBe(401);
    await app.close();
  });

  it("rejects unsigned scope headers that conflict with the provider binding", async () => {
    const rawBody = JSON.stringify(baseEvent);
    const app = buildApp({ db: makeDb(), eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    const response = await app.inject({ method: "POST", url: "/v1/events", payload: rawBody, headers: { "content-type": "application/json", "x-fanloom-provider": provider, "x-fanloom-tenant": "attacker-tenant", "x-fanloom-community": "community-1", "x-fanloom-timestamp": String(timestamp), "x-fanloom-signature": sign(rawBody) } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a conflicting duplicate with the same tenant/provider event key", async () => {
    const db = makeDb();
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    expect((await postEvent(app, baseEvent)).statusCode).toBe(202);
    expect((await postEvent(app, Object.assign({}, baseEvent, { payload: { source: "different" } }))).statusCode).toBe(409);
    await app.close();
  });

  it("allows the same provider event id in different tenant scopes", async () => {
    const db = makeDb();
    const first = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    const second = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-2", communityId: "community-2" } } });
    expect((await postEvent(first, baseEvent)).statusCode).toBe(202);
    const rawBody = JSON.stringify(baseEvent);
    const response = await second.inject({ method: "POST", url: "/v1/events", payload: rawBody, headers: { "content-type": "application/json", "x-fanloom-provider": provider, "x-fanloom-tenant": "tenant-2", "x-fanloom-community": "community-2", "x-fanloom-timestamp": String(timestamp), "x-fanloom-signature": sign(rawBody) } });
    expect(response.statusCode).toBe(202);
    expect(db._state.events).toHaveLength(2);
    await first.close();
    await second.close();
  });

  it("stores only bounded allowlisted metadata and redacts sensitive fields", async () => {
    const db = makeDb();
    const app = buildApp({ db, eventProviderSecrets: { [provider]: secret }, eventProviderBindings: { [provider]: { tenantId: "tenant-1", communityId: "community-1" } } });
    const response = await postEvent(app, Object.assign({}, baseEvent, { payload: { source: "community", contentId: "post-1", email: "alice@example.com", phone: "+84123456789", token: "secret", message: "private", nested: { tooDeep: true } } }));
    expect(response.statusCode).toBe(202);
    expect(db._state.events[0].payload).toEqual({ source: "community", contentId: "post-1" });
    expect(JSON.stringify(db._state.events[0].payload)).not.toMatch(/alice|841234|secret|private/);
    await app.close();
  });
});
