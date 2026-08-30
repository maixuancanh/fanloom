import { validateCampaignDecision } from "./contracts.js";
export type MindReply = { mindId: string; requestId: string; transcriptRef?: string; payload: unknown };
export type MindClient = { evaluate(input: { alias: string; events: readonly string[] }): Promise<MindReply> };
export async function evaluateCampaign(client: MindClient, input: { events: readonly string[]; configuredMindId: string; alias: string }) {
  if (!input.configuredMindId || !input.alias) return { ok: false as const, reason: "invalid_mind_identity" };
  try {
    const reply = await client.evaluate({ alias: input.alias, events: input.events });
    if (reply.mindId !== input.configuredMindId) return { ok: false as const, reason: "foreign_mind_identity" };
    const decision = validateCampaignDecision(reply.payload);
    const missing = decision.evidenceEventIds.some(id => !input.events.includes(id));
    if (missing) return { ok: false as const, reason: "missing_evidence" };
    return { ok: true as const, decision, requestId: reply.requestId, transcriptRef: reply.transcriptRef };
  } catch { return { ok: false as const, reason: "invalid_mind_decision" }; }
}
