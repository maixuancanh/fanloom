import { describe, expect, it, vi } from "vitest";
import { processCreatorAdvisor } from "../src/process-advisor.js";

const creatorProfile = { id: "creator-1", displayName: "Linh", niche: "Vietnamese indie-pop music", audience: "Vietnamese listeners aged 18-28", priorityChannels: ["Instagram", "TikTok"], goal30Day: "Gain 300 followers", differentiator: "Bilingual city-life songs" };
const job = { id: "job-1", tenantId: "tenant-1", communityId: "community-1", payload: { creatorId: "creator-1", eventIds: ["event-1"], conversationAlias: "fanloom:creator-1:advisor", creatorProfile, trigger: "autonomous", parentAuditId: "audit-parent", previousSummary: "Prioritize curator outreach" } };
describe("creator advisor processing", () => {
  it("persists only a validated advisory draft", async () => {
    const upsert = vi.fn(async (value: unknown) => value);
    const result = await processCreatorAdvisor(job, { configuredMindId: "enzo95", db: { mindAdvisorAudit: { upsert } }, client: { advise: async () => ({ mindId: "enzo95", requestId: "request-1", payload: { summary: "Lead", evidenceEventIds: ["event-1"], recommendationType: "partner_lead", draft: "Reach out." } }) } });
    expect(result).toMatchObject({ ok: true, requestId: "request-1" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ mindId: "enzo95", conversationAlias: "fanloom:creator-1:advisor", trigger: "autonomous", parentAuditId: "audit-parent", creatorProfileSnapshot: creatorProfile, validation: { ok: true } }) }));
  });
  it("does not call the Mind for malformed jobs", async () => {
    const advise = vi.fn(); const upsert = vi.fn();
    await expect(processCreatorAdvisor({ ...job, payload: { creatorId: "", eventIds: ["event-1"] } }, { configuredMindId: "enzo95", db: { mindAdvisorAudit: { upsert } }, client: { advise } })).resolves.toEqual({ ok: false, reason: "invalid_advisor_recommendation" });
    expect(advise).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
  });
});
