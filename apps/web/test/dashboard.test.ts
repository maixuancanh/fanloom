import { describe, expect, it } from "vitest";
import { actionStatusLabel, formatAdvisorDraft, loadAdvisorDashboard, loadAudienceDashboard, loadCampaignDashboard, loadCreatorDashboard } from "../src/dashboard.js";

describe("dashboard integration", () => {
  it("maps durable action state into creator-facing labels", () => {
    expect(actionStatusLabel({ status: "awaiting_approval", executionStatus: "not_started" })).toBe("Awaiting approval");
    expect(actionStatusLabel({ status: "pending", executionStatus: "unknown" })).toBe("Reconciliation pending");
    expect(actionStatusLabel({ status: "completed", executionStatus: "succeeded" })).toBe("Executed");
    expect(actionStatusLabel({ status: "executed", executionStatus: "not_started" })).toBe("Executed");
  });

  it("loads campaigns from the Fanloom dashboard endpoint", async () => {
    const campaigns = await loadCampaignDashboard(async () => new Response(JSON.stringify({ campaigns: [{ id: "campaign-1", name: "Welcome", status: "active", budgetLimitMinor: "1000", spentMinor: "0", actions: [] }] }), { status: 200 }));
    expect(campaigns[0]?.id).toBe("campaign-1");
  });

  it("loads the consent-aware audience view", async () => {
    const fans = await loadAudienceDashboard(async () => new Response(JSON.stringify({ fans: [{ id: "fan-1", handle: "alice", engagementCount: 2, rewardBalanceMinor: "250", personalizationConsent: "active", joinedAt: "2026-08-26T00:00:00.000Z" }] }), { status: 200 }));
    expect(fans[0]?.personalizationConsent).toBe("active");
  });

  it("loads draft-only growth advice", async () => {
    const advice = await loadAdvisorDashboard(async () => new Response(JSON.stringify({ recommendations: [{ id: "advisor-1", summary: "Partner lead", evidenceEventIds: ["event-1"], recommendationType: "partner_lead", draft: "Hello", mindId: "enzo95", conversationAlias: "fanloom:creator-1:advisor", trigger: "autonomous", parentAuditId: "advisor-parent", creatorProfileSnapshot: { displayName: "Linh" }, continuityDepth: 1, createdAt: "2026-08-27T00:00:00.000Z", draftOnly: true }] }), { status: 200 }));
    expect(advice[0]).toMatchObject({ mindId: "enzo95", draftOnly: true, trigger: "autonomous", parentAuditId: "advisor-parent", continuityDepth: 1 });
  });

  it("loads the durable creator brief used by the Mind", async () => {
    const creator = await loadCreatorDashboard(async () => new Response(JSON.stringify({ creator: { id: "creator-1", displayName: "Linh", niche: "Vietnamese indie-pop music", audience: "Vietnamese listeners 18-28", priorityChannels: ["Instagram", "TikTok"], goal30Day: "+300 followers", differentiator: "Bilingual city-life songs", complete: true, missingFields: [] } }), { status: 200 }));
    expect(creator).toMatchObject({ displayName: "Linh", complete: true, priorityChannels: ["Instagram", "TikTok"] });
  });

  it("formats structured Mind drafts for safe, readable rendering", () => {
    expect(formatAdvisorDraft('{"subject":"A creator pitch","body":"Hello [Name]"}')).toBe('{\n  "subject": "A creator pitch",\n  "body": "Hello [Name]"\n}');
  });
});
