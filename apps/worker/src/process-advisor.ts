import { evaluateAdvisorBrief, type AdvisorClient, type CreatorAdvisorProfile } from "../../../packages/minds/src/advisor.js";

type AdvisorJob = { id: string; tenantId: string; communityId: string; payload: { creatorId?: unknown; eventIds?: unknown; conversationAlias?: unknown; creatorProfile?: unknown; previousSummary?: unknown; trigger?: unknown; parentAuditId?: unknown } };
type AdvisorDb = { mindAdvisorAudit: { upsert(args: unknown): Promise<unknown> } };

export async function processCreatorAdvisor(job: AdvisorJob, options: { configuredMindId: string; client: AdvisorClient; db: AdvisorDb }) {
  const creatorId = job.payload.creatorId;
  const eventIds = job.payload.eventIds;
  if (typeof creatorId !== "string" || !creatorId.trim() || (eventIds !== undefined && (!Array.isArray(eventIds) || eventIds.some((id) => typeof id !== "string" || !id.trim())))) {
    return { ok: false as const, reason: "invalid_advisor_recommendation" };
  }
  const creatorProfile = job.payload.creatorProfile && typeof job.payload.creatorProfile === "object" && !Array.isArray(job.payload.creatorProfile) ? job.payload.creatorProfile as CreatorAdvisorProfile : { displayName: "Creator", niche: "Unknown", audience: "Unknown", priorityChannels: [], goal30Day: "Unknown", differentiator: "Unknown" };
  const conversationAlias = typeof job.payload.conversationAlias === "string" && job.payload.conversationAlias.trim() ? job.payload.conversationAlias : `fanloom:${creatorId}:advisor`;
  const previousSummary = typeof job.payload.previousSummary === "string" ? job.payload.previousSummary : undefined;
  const trigger = job.payload.trigger === "autonomous" ? "autonomous" : "manual";
  const parentAuditId = typeof job.payload.parentAuditId === "string" && job.payload.parentAuditId.trim() ? job.payload.parentAuditId : undefined;
  const result = await evaluateAdvisorBrief(options.client, { configuredMindId: options.configuredMindId, creatorId, events: eventIds ?? [], conversationAlias, creatorProfile, previousSummary });
  const accepted = result.ok;
  if (process.env.NODE_ENV !== "test") {
    console.info("fanloom_advisor_evaluated", { jobId: job.id, accepted, reason: accepted ? undefined : result.reason });
  }
  await options.db.mindAdvisorAudit.upsert({
    where: { outboxJobId: job.id },
    create: {
      outboxJobId: job.id, tenantId: job.tenantId, communityId: job.communityId, creatorId,
      mindId: options.configuredMindId, requestId: accepted ? result.requestId : `rejected:${job.id}`,
      conversationAlias, trigger, parentAuditId, creatorProfileSnapshot: creatorProfile,
      transcriptRef: accepted ? result.transcriptRef : undefined,
      recommendation: accepted ? result.recommendation : undefined,
      validation: accepted ? { ok: true } : { ok: false, reason: result.reason },
      followUpAt: accepted && result.recommendation.followUpAt ? new Date(result.recommendation.followUpAt) : undefined,
    },
    update: {},
  });
  return result;
}
