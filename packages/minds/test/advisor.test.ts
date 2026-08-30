import { describe, expect, it } from "vitest";
import { evaluateAdvisorBrief, validateAdvisorRecommendation } from "../src/advisor.js";
import { MindsHttpClient } from "../src/client.js";

const advice = { summary: "Draft a partnership introduction.", evidenceEventIds: ["event-1"], recommendationType: "outreach_draft" as const, draft: "Hello, I would love to collaborate." };
const creatorProfile = { displayName: "Linh", niche: "Vietnamese indie-pop music", audience: "Vietnamese listeners aged 18-28", priorityChannels: ["Instagram", "TikTok"], goal30Day: "Gain 300 followers and qualify 5 partner leads", differentiator: "Intimate bilingual songs about contemporary city life" };

describe("creator growth advisor", () => {
  it("accepts a valid draft from the configured Mind", async () => {
    await expect(evaluateAdvisorBrief({ advise: async () => ({ mindId: "enzo95", requestId: "request-1", payload: advice }) }, { configuredMindId: "enzo95", creatorId: "creator-1", events: ["event-1"], conversationAlias: "fanloom:creator-1:advisor", creatorProfile })).resolves.toEqual({ ok: true, recommendation: advice, requestId: "request-1", transcriptRef: undefined });
  });
  it("rejects foreign identities and authority-bearing results", async () => {
    await expect(evaluateAdvisorBrief({ advise: async () => ({ mindId: "other", requestId: "request-1", payload: advice }) }, { configuredMindId: "enzo95", creatorId: "creator-1", events: ["event-1"], conversationAlias: "fanloom:creator-1:advisor", creatorProfile })).resolves.toEqual({ ok: false, reason: "foreign_mind_identity" });
    expect(() => validateAdvisorRecommendation({ ...advice, action: "send" })).toThrow("invalid_advisor_recommendation");
    expect(() => validateAdvisorRecommendation({ ...advice, maxSpendMinor: 1 })).toThrow("invalid_advisor_recommendation");
  });
  it("normalizes a structured Mind draft for safe dashboard rendering", () => {
    const recommendation = validateAdvisorRecommendation({ ...advice, draft: { objective: "Grow Instagram", cadence: ["Reel", "Carousel"] } });
    expect(recommendation.draft).toBe('{"objective":"Grow Instagram","cadence":["Reel","Carousel"]}');
  });
  it("sends advice when a freshly-created alias has no resolved Mind id yet", async () => {
    let sent = false, prompt = "";
    const liveClient = {
      ensureConversation: async () => ({ conversationId: "conversation-1" }), getMindIdForAlias: async () => undefined,
      getLatestHistoryFingerprint: async () => undefined,
      sendMessage: async ({ messageText }: { messageText: string }) => { sent = true; prompt = messageText; return { messageId: "message-1" }; },
      waitForReply: async ({ timeoutMs }: { timeoutMs: number }) => { expect(timeoutMs).toBe(120_000); return { timedOut: false as const, reply: { fingerprint: "reply-1", messageText: JSON.stringify(advice) } }; },
    };
    const client = new MindsHttpClient({ apiKey: "builder-key", mindId: "enzo95", baseUrl: "https://minds.test", mindsClient: liveClient as never });
    await expect(client.advise({ creatorId: "creator-1", events: ["event-1"], conversationAlias: "fanloom:creator-1:advisor", creatorProfile, previousSummary: "Linh previously prioritized curator outreach." })).resolves.toMatchObject({ mindId: "enzo95", requestId: "message-1" });
    expect(sent).toBe(true);
    expect(prompt).toContain("You are Fanloom");
    expect(prompt).toContain('"displayName":"Linh"');
    expect(prompt).toContain("Linh previously prioritized curator outreach.");
    expect(prompt).not.toContain("enzo95");
  });
});
