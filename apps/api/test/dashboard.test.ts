import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createCsrfToken, issueSession } from "../src/auth/session.js";

describe("creator dashboard API", () => {
  const creatorProfile = {
    id: "creator-profile-1",
    communityId: "community-1",
    displayName: "Linh",
    niche: "Vietnamese indie-pop music",
    audience: "Vietnamese listeners aged 18-28 who follow indie and pop music",
    priorityChannels: ["Instagram", "TikTok"],
    goal30Day: "Gain 300 Instagram followers and qualify 5 partner leads",
    differentiator: "Intimate bilingual songs shaped by contemporary Vietnamese city life",
  };

  function creatorHeaders(token: string, key = "profile-1") {
    return { authorization: `Bearer ${token}`, origin: "fanloom-origin", "x-csrf-token": createCsrfToken(token, "fanloom-origin", "test-secret"), "idempotency-key": key };
  }

  it("issues a local creator session when local demo mode is enabled", async () => {
    const db: any = { user: { findUnique: async () => ({ id: "local-user", tenantId: "00000000-0000-0000-0000-000000000001", communityId: "00000000-0000-0000-0000-000000000002", role: "creator", creator: { id: "local-creator" } }) } };
    const app = buildApp({ db, sessionSecret: "test-secret", localDemo: true });
    const response = await app.inject({ method: "POST", url: "/v1/auth/local" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: "local-user", role: "creator" } });
    expect(response.json().token).toEqual(expect.any(String));
    await app.close();
  });

  it("lists campaign actions with durable execution status", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const db: any = { user: { findFirst: async () => ({ id: "creator-1", role: "creator", tenantId: "tenant-1", creator: { id: "creator-profile-1" } }) }, campaign: { findMany: async () => [{ id: "campaign-1", name: "Welcome", status: "active", budgetLimitMinor: 1000, spentMinor: 100, actions: [{ id: "action-1", actionType: "message", status: "completed", amountMinor: 0, maxSpendMinor: 0, createdAt: new Date("2026-08-26T00:00:00Z"), connectorExecution: { status: "succeeded" } }] }] } };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin" });
    const response = await app.inject({ method: "GET", url: "/v1/dashboard/campaigns", headers: { authorization: `Bearer ${token}`, origin: "fanloom-origin", "x-csrf-token": createCsrfToken(token, "fanloom-origin", "test-secret") } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ campaigns: [{ id: "campaign-1", actions: [{ executionStatus: "succeeded" }] }] });
    await app.close();
  });

  it("reads and updates only the authenticated creator brief", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const update = vi.fn(async ({ data }: any) => ({ ...creatorProfile, ...data }));
    const db: any = {
      user: { findFirst: async () => ({ id: "creator-1", role: "creator", tenantId: "tenant-1", creator: creatorProfile }) },
      creator: { update },
    };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin" });
    const before = await app.inject({ method: "GET", url: "/v1/dashboard/creator", headers: creatorHeaders(token) });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ creator: { displayName: "Linh", priorityChannels: ["Instagram", "TikTok"], complete: true } });

    const after = await app.inject({ method: "PATCH", url: "/v1/dashboard/creator", headers: creatorHeaders(token), payload: { ...creatorProfile, goal30Day: "Book 3 qualified collaborations in 30 days" } });
    expect(after.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "creator-profile-1" }, data: expect.objectContaining({ goal30Day: "Book 3 qualified collaborations in 30 days" }) }));
    expect(after.json()).toMatchObject({ creator: { displayName: "Linh", complete: true } });
    await app.close();
  });

  it("rejects advisor work when the creator brief is incomplete", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const db: any = { user: { findFirst: async () => ({ id: "creator-1", role: "creator", tenantId: "tenant-1", creator: { ...creatorProfile, niche: null } }) } };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin" });
    const response = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/requests", headers: creatorHeaders(token, "advisor-incomplete"), payload: { eventIds: ["event-1"] } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "creator_profile_incomplete", missingFields: ["niche"] });
    await app.close();
  });

  it("lists consented fans and their engagement totals", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const db: any = {
      user: { findFirst: async () => ({ id: "creator-1", role: "creator", tenantId: "tenant-1", creator: { id: "creator-profile-1" } }) },
      fan: { findMany: async () => [{ id: "fan-1", handle: "alice", createdAt: new Date("2026-08-26T00:00:00Z"), consents: [{ purpose: "personalization", status: "active" }], events: [{ id: "event-1" }, { id: "event-2" }], rewards: [{ amountMinor: 250 }] }] },
    };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin" });
    const response = await app.inject({ method: "GET", url: "/v1/dashboard/audience", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ fans: [{ handle: "alice", engagementCount: 2, rewardBalanceMinor: "250", personalizationConsent: "active" }] });
    await app.close();
  });

  it("shows only draft-safe enzo95 recommendations", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const findMany = vi.fn(async () => [
      { id: "audit-child", mindId: "enzo95", conversationAlias: "fanloom:creator-profile-1:advisor", trigger: "autonomous", parentAuditId: "audit-parent", creatorProfileSnapshot: { displayName: "Linh" }, createdAt: new Date("2026-08-30T02:00:00.000Z"), followUpAt: null, recommendation: { summary: "Continue curator outreach", evidenceEventIds: ["event-1"], recommendationType: "partner_lead", draft: "Follow up" } },
      { id: "audit-parent", mindId: "enzo95", conversationAlias: "fanloom:creator-profile-1:advisor", trigger: "manual", parentAuditId: null, creatorProfileSnapshot: { displayName: "Linh" }, createdAt: new Date("2026-08-30T01:00:00.000Z"), followUpAt: new Date("2026-08-30T02:00:00.000Z"), recommendation: { summary: "Partner lead", evidenceEventIds: ["event-1"], recommendationType: "partner_lead", draft: "Hello" } },
      { id: "audit-legacy", mindId: "enzo95", conversationAlias: "", trigger: "manual", parentAuditId: null, creatorProfileSnapshot: {}, createdAt: new Date("2026-08-29T00:00:00.000Z"), followUpAt: null, recommendation: { summary: "Legacy", evidenceEventIds: ["event-1"], recommendationType: "no_action", draft: "Old" } },
      { id: "audit-rejected", conversationAlias: "fanloom:creator-profile-1:advisor", recommendation: null },
    ]);
    const db: any = { user: { findFirst: async () => ({ id: "creator-1", role: "creator", tenantId: "tenant-1", creator: { id: "creator-profile-1" } }) }, mindAdvisorAudit: { findMany } };
    const app = buildApp({ db, sessionSecret: "test-secret" });
    const response = await app.inject({ method: "GET", url: "/v1/dashboard/advisor", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ recommendations: [
      expect.objectContaining({ id: "audit-child", mindId: "enzo95", draftOnly: true, draft: "Follow up", conversationAlias: "fanloom:creator-profile-1:advisor", trigger: "autonomous", parentAuditId: "audit-parent", creatorProfileSnapshot: { displayName: "Linh" }, continuityDepth: 1 }),
      expect.objectContaining({ id: "audit-parent", trigger: "manual", parentAuditId: null, continuityDepth: 0 }),
    ] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { creatorId: "creator-profile-1", tenantId: "tenant-1", conversationAlias: { not: "" } } }));
    await app.close();
  });

  it("queues advisor work only for consented creator evidence", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret"), create = vi.fn(async () => ({ id: "job-1" }));
    const db: any = { user: { findFirst: async () => ({ id: "creator-1", role: "creator", tenantId: "tenant-1", creator: creatorProfile }) }, mindAdvisorAudit: { findFirst: async () => ({ id: "audit-previous", recommendation: { summary: "Previous partner direction" } }) }, engagementEvent: { findMany: async () => [{ id: "event-1", fanId: "fan-1" }] }, consentGrant: { findFirst: async () => ({ id: "consent-1" }) }, outboxJob: { create } };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin" });
    const response = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/requests", headers: { authorization: `Bearer ${token}`, origin: "fanloom-origin", "x-csrf-token": createCsrfToken(token, "fanloom-origin", "test-secret"), "idempotency-key": "advisor-1" }, payload: { eventIds: ["event-1"] } });
    expect(response.statusCode).toBe(202); expect(response.json()).toEqual({ id: "job-1", status: "queued", draftOnly: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ topic: "creator.advisor.evaluate", payload: expect.objectContaining({ creatorId: "creator-profile-1", eventIds: ["event-1"], trigger: "manual", conversationAlias: "fanloom:creator-profile-1:advisor", parentAuditId: "audit-previous", previousSummary: "Previous partner direction", creatorProfile: expect.objectContaining({ displayName: "Linh", niche: "Vietnamese indie-pop music", priorityChannels: ["Instagram", "TikTok"] }) }) }) }));
    await app.close();
  });

  it("keeps autonomous demo advancement unavailable outside demo mode", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const app = buildApp({ db: {}, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin", localDemo: false });
    const response = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/follow-up-demo", headers: creatorHeaders(token, "follow-up-disabled") });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    await app.close();
  });

  it("requires the creator session and matching CSRF token for demo advancement", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const findFirst = vi.fn(async () => ({ id: "creator-1", creator: creatorProfile }));
    const app = buildApp({ db: { user: { findFirst } }, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin", localDemo: true });
    const missingSession = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/follow-up-demo", headers: { origin: "fanloom-origin" } });
    expect(missingSession.statusCode).toBe(403);
    const invalidCsrf = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/follow-up-demo", headers: { ...creatorHeaders(token, "follow-up-csrf"), "x-csrf-token": "invalid" } });
    expect(invalidCsrf.statusCode).toBe(403);
    expect(invalidCsrf.json()).toEqual({ error: "csrf_rejected" });
    expect(findFirst).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns checkpoint_not_found without creating work when no contextual checkpoint exists", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const update = vi.fn();
    const db: any = {
      user: { findFirst: async () => ({ id: "creator-1", tenantId: "tenant-1", creator: creatorProfile }) },
      mindAdvisorAudit: { findFirst: async () => null, update },
    };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin", localDemo: true });
    const response = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/follow-up-demo", headers: creatorHeaders(token, "follow-up-missing") });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "checkpoint_not_found" });
    expect(update).not.toHaveBeenCalled();
    await app.close();
  });

  it("only makes the authenticated demo creator's newest contextual checkpoint due", async () => {
    const token = issueSession({ userId: "creator-1", role: "creator", tenantId: "tenant-1" }, "test-secret");
    const checkpoint = { id: "audit-contextual", followUpAt: new Date("2026-09-05T00:00:00.000Z") };
    const findFirst = vi.fn(async () => checkpoint);
    const update = vi.fn(async ({ data }: any) => ({ ...checkpoint, followUpAt: data.followUpAt }));
    const db: any = {
      user: { findFirst: async () => ({ id: "creator-1", tenantId: "tenant-1", creator: creatorProfile }) },
      mindAdvisorAudit: { findFirst, update },
    };
    const app = buildApp({ db, sessionSecret: "test-secret", allowedOrigin: "fanloom-origin", localDemo: true });
    const response = await app.inject({ method: "POST", url: "/v1/dashboard/advisor/follow-up-demo", headers: creatorHeaders(token, "follow-up-valid") });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ auditId: "audit-contextual", status: "due", followUpAt: expect.any(String) });
    expect(findFirst).toHaveBeenCalledWith({
      where: { creatorId: "creator-profile-1", tenantId: "tenant-1", recommendation: { not: null }, conversationAlias: { not: "" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, followUpAt: true },
    });
    expect(update).toHaveBeenCalledWith({ where: { id: "audit-contextual" }, data: { followUpAt: expect.any(Date) }, select: { id: true, followUpAt: true } });
    await app.close();
  });
});
