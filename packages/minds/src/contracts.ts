export type CampaignAction = "message" | "mission" | "reward" | "no_action";
export type CampaignDecision = { summary: string; evidenceEventIds: string[]; action: CampaignAction; fanId?: string; maxSpendMinor: number; requiresApproval: boolean; followUpAt?: string };
export function validateCampaignDecision(value: unknown): CampaignDecision {
  if (!value || typeof value !== "object") throw new Error("invalid_mind_decision");
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string" || !v.summary.trim() || !Array.isArray(v.evidenceEventIds) || v.evidenceEventIds.length === 0 || v.evidenceEventIds.some(x => typeof x !== "string" || !x)) throw new Error("invalid_mind_decision");
  if (!["message","mission","reward","no_action"].includes(String(v.action)) || !Number.isSafeInteger(v.maxSpendMinor) || Number(v.maxSpendMinor) < 0 || typeof v.requiresApproval !== "boolean") throw new Error("invalid_mind_decision");
  if (v.fanId !== undefined && typeof v.fanId !== "string") throw new Error("invalid_mind_decision");
  if (v.followUpAt !== undefined && (typeof v.followUpAt !== "string" || Number.isNaN(Date.parse(v.followUpAt)))) throw new Error("invalid_mind_decision");
  return v as unknown as CampaignDecision;
}
