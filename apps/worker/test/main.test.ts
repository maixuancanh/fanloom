import { describe, expect, it } from "vitest";
import { WORKER_SERVICE } from "../src/main.js";
import { processEngagementEvaluation } from "../src/evaluate-event.js";

describe("worker identity", () => {
  it("has the Fanloom worker service name", () => {
    expect(WORKER_SERVICE).toBe("fanloom-worker");
  });

  it("persists request, transcript, decision, and validation at the outbox boundary", async () => {
    const audits: unknown[] = [];
    let evaluatedAlias = "";
    const result = await processEngagementEvaluation({ id: "job-1", tenantId: "tenant-1", communityId: "community-1", payload: { eventId: "evt-1" } }, {
      client: { evaluate: async ({ alias }) => { evaluatedAlias = alias; return { mindId: "fanloom", requestId: "req-1", transcriptRef: "tr-1", payload: { summary: "ok", evidenceEventIds: ["evt-1"], action: "no_action", maxSpendMinor: 0, requiresApproval: false } }; } },
      configuredMindId: "fanloom",
      db: { mindEvaluationAudit: { upsert: async ({ create }: { create: unknown }) => { audits.push(create); return create; } } },
    });
    expect(result.ok).toBe(true);
    expect(evaluatedAlias).toBe("fanloom:fanloom:engagement");
    expect(audits[0]).toMatchObject({ requestId: "req-1", transcriptRef: "tr-1", validation: { ok: true }, decision: { action: "no_action" } });
  });
});
