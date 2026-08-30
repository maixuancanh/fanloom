export type AdvisorRecommendationType = "partner_lead" | "outreach_draft" | "social_plan" | "no_action";

export type AdvisorRecommendation = {
  summary: string;
  evidenceEventIds: string[];
  recommendationType: AdvisorRecommendationType;
  draft: string;
  followUpAt?: string;
};

export type AdvisorReply = { mindId: string; requestId: string; transcriptRef?: string; payload: unknown };
export type CreatorAdvisorProfile = { id?: string; displayName: string; niche: string; audience: string; priorityChannels: string[]; goal30Day: string; differentiator: string };
export type AdvisorClient = { advise(input: { creatorId: string; events: readonly string[]; conversationAlias: string; creatorProfile: CreatorAdvisorProfile; previousSummary?: string }): Promise<AdvisorReply> };

const recommendationTypes: readonly AdvisorRecommendationType[] = ["partner_lead", "outreach_draft", "social_plan", "no_action"];
const forbiddenAuthorityFields = ["maxSpendMinor", "requiresApproval", "action", "fanId"] as const;
const allowedRecommendationFields = ["summary", "evidenceEventIds", "recommendationType", "draft", "followUpAt"] as const;

function isAdvisorReply(value: unknown): value is AdvisorReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  return typeof reply.mindId === "string" && !!reply.mindId.trim()
    && typeof reply.requestId === "string" && !!reply.requestId.trim()
    && (reply.transcriptRef === undefined || typeof reply.transcriptRef === "string");
}

export function validateAdvisorRecommendation(value: unknown): AdvisorRecommendation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_advisor_recommendation");
  const recommendation = value as Record<string, unknown>;
  if (forbiddenAuthorityFields.some((field) => field in recommendation)) throw new Error("invalid_advisor_recommendation");
  if (Object.keys(recommendation).some((field) => !(allowedRecommendationFields as readonly string[]).includes(field))) throw new Error("invalid_advisor_recommendation");
  if (typeof recommendation.summary !== "string" || !recommendation.summary.trim()) throw new Error("invalid_advisor_recommendation");
  if (!Array.isArray(recommendation.evidenceEventIds) || recommendation.evidenceEventIds.length === 0 || recommendation.evidenceEventIds.some((id) => typeof id !== "string" || !id)) throw new Error("invalid_advisor_recommendation");
  if (!recommendationTypes.includes(recommendation.recommendationType as AdvisorRecommendationType)) throw new Error("invalid_advisor_recommendation");
  if (typeof recommendation.draft !== "string") {
    if (!recommendation.draft || typeof recommendation.draft !== "object" || Array.isArray(recommendation.draft)) throw new Error("invalid_advisor_recommendation");
    recommendation.draft = JSON.stringify(recommendation.draft);
  }
  if (recommendation.followUpAt !== undefined && (typeof recommendation.followUpAt !== "string" || Number.isNaN(Date.parse(recommendation.followUpAt)))) throw new Error("invalid_advisor_recommendation");
  return recommendation as unknown as AdvisorRecommendation;
}

export async function evaluateAdvisorBrief(client: AdvisorClient, input: { configuredMindId: string; creatorId: string; events: readonly string[]; conversationAlias: string; creatorProfile: CreatorAdvisorProfile; previousSummary?: string }) {
  if (!input.configuredMindId || !input.creatorId) return { ok: false as const, reason: "invalid_advisor_recommendation" };
  try {
    const reply: unknown = await client.advise({ creatorId: input.creatorId, events: input.events, conversationAlias: input.conversationAlias, creatorProfile: input.creatorProfile, previousSummary: input.previousSummary });
    if (!isAdvisorReply(reply)) return { ok: false as const, reason: "invalid_advisor_recommendation" };
    if (reply.mindId !== input.configuredMindId) return { ok: false as const, reason: "foreign_mind_identity" };
    const recommendation = validateAdvisorRecommendation(reply.payload);
    if (recommendation.evidenceEventIds.some((eventId) => !input.events.includes(eventId))) return { ok: false as const, reason: "invalid_advisor_recommendation" };
    return { ok: true as const, recommendation, requestId: reply.requestId, transcriptRef: reply.transcriptRef };
  } catch { return { ok: false as const, reason: "invalid_advisor_recommendation" }; }
}
