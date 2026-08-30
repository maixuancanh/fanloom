import { describe, expect, it, vi } from "vitest";
import { queueDueAdvisorFollowUps } from "../src/advisor-followups.js";

describe("advisor follow-up scheduler", () => {
  it("queues one draft-only advisor evaluation for a due checkpoint", async () => {
    const create = vi.fn(async (value: unknown) => value);
    const queued = await queueDueAdvisorFollowUps({
      mindAdvisorAudit: { findMany: async () => [{
        id: "audit-1", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1",
        conversationAlias: "fanloom:creator-1:advisor",
        creatorProfileSnapshot: { displayName: "Linh", niche: "Vietnamese indie-pop music", audience: "Vietnamese listeners 18-28", priorityChannels: ["Instagram", "TikTok"], goal30Day: "+300 Instagram followers and 5 qualified partnership leads", differentiator: "Bilingual songs about contemporary Vietnamese city life" },
        followUpAt: new Date("2026-08-28T10:00:00.000Z"),
        recommendation: { summary: "Prioritize curator outreach this week.", evidenceEventIds: ["event-1"] },
      }] },
      engagementEvent: { findMany: async () => [{ id: "event-1", fanId: "fan-1" }] },
      consentGrant: { findMany: async () => [{ fanId: "fan-1" }] },
      outboxJob: { create },
    }, new Date("2026-08-28T10:01:00.000Z"));

    expect(queued).toBe(1);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: "tenant-1",
      communityId: "community-1",
      topic: "creator.advisor.evaluate",
      idempotencyKey: "advisor-followup:audit-1:2026-08-28T10:00:00.000Z",
      payload: {
        creatorId: "creator-1",
        eventIds: ["event-1"],
        trigger: "autonomous",
        parentAuditId: "audit-1",
        conversationAlias: "fanloom:creator-1:advisor",
        previousSummary: "Prioritize curator outreach this week.",
        creatorProfile: { displayName: "Linh", niche: "Vietnamese indie-pop music", audience: "Vietnamese listeners 18-28", priorityChannels: ["Instagram", "TikTok"], goal30Day: "+300 Instagram followers and 5 qualified partnership leads", differentiator: "Bilingual songs about contemporary Vietnamese city life" },
      },
    }) });
  });

  it("does not create a campaign action or queue non-actionable checkpoints", async () => {
    const create = vi.fn();
    const queued = await queueDueAdvisorFollowUps({
      mindAdvisorAudit: { findMany: async () => [{ id: "audit-1", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1", followUpAt: new Date("2026-08-28T10:00:00.000Z"), recommendation: { evidenceEventIds: [] } }] },
      engagementEvent: { findMany: async () => [] },
      consentGrant: { findMany: async () => [] },
      outboxJob: { create },
      campaignAction: { create: vi.fn(() => { throw new Error("must_not_create_action"); }) },
    }, new Date("2026-08-28T10:01:00.000Z"));

    expect(queued).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("skips a due follow-up when its original consent has been revoked", async () => {
    const create = vi.fn();
    const queued = await queueDueAdvisorFollowUps({
      mindAdvisorAudit: { findMany: async () => [{ id: "audit-1", tenantId: "tenant-1", communityId: "community-1", creatorId: "creator-1", followUpAt: new Date("2026-08-28T10:00:00.000Z"), recommendation: { evidenceEventIds: ["event-1"] } }] },
      engagementEvent: { findMany: async () => [{ id: "event-1", fanId: "fan-1" }] },
      consentGrant: { findMany: async () => [] },
      outboxJob: { create },
    }, new Date("2026-08-28T10:01:00.000Z"));

    expect(queued).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
