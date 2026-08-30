type DueAdvisorAudit = {
  id: string;
  tenantId: string;
  communityId: string;
  creatorId: string;
  conversationAlias: string;
  creatorProfileSnapshot: unknown;
  followUpAt: Date;
  recommendation: unknown;
};
type AdvisorFollowUpDb = {
  mindAdvisorAudit: { findMany(args: unknown): Promise<DueAdvisorAudit[]> };
  engagementEvent: { findMany(args: unknown): Promise<Array<{ id: string; fanId: string | null }>> };
  consentGrant: { findMany(args: unknown): Promise<Array<{ fanId: string }>> };
  outboxJob: { create(args: unknown): Promise<unknown> };
};

export async function queueDueAdvisorFollowUps(db: AdvisorFollowUpDb, now = new Date()): Promise<number> {
  const audits = await db.mindAdvisorAudit.findMany({
    where: { followUpAt: { lte: now }, recommendation: { not: null } },
    select: { id: true, tenantId: true, communityId: true, creatorId: true, conversationAlias: true, creatorProfileSnapshot: true, followUpAt: true, recommendation: true },
    take: 100,
  });
  let queued = 0;
  for (const audit of audits) {
    const recommendation = audit.recommendation;
    const previousSummary = recommendation && typeof recommendation === "object" && !Array.isArray(recommendation) && typeof (recommendation as { summary?: unknown }).summary === "string"
      ? (recommendation as { summary: string }).summary
      : undefined;
    const eventIds = recommendation && typeof recommendation === "object" && !Array.isArray(recommendation) && Array.isArray((recommendation as { evidenceEventIds?: unknown }).evidenceEventIds)
      ? (recommendation as { evidenceEventIds: unknown[] }).evidenceEventIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (!eventIds.length) continue;
    const events = await db.engagementEvent.findMany({ where: { id: { in: eventIds }, creatorId: audit.creatorId, tenantId: audit.tenantId }, select: { id: true, fanId: true } });
    const fanIds = [...new Set(events.flatMap((event) => event.fanId ? [event.fanId] : []))];
    if (events.length !== eventIds.length || fanIds.length === 0) continue;
    const consents = await db.consentGrant.findMany({ where: { fanId: { in: fanIds }, tenantId: audit.tenantId, creatorId: audit.creatorId, purpose: "personalization", status: "active", revokedAt: null }, select: { fanId: true } });
    if (new Set(consents.map((consent) => consent.fanId)).size !== fanIds.length) continue;
    try {
      await db.outboxJob.create({
        data: {
          tenantId: audit.tenantId,
          communityId: audit.communityId,
          topic: "creator.advisor.evaluate",
          idempotencyKey: `advisor-followup:${audit.id}:${audit.followUpAt.toISOString()}`,
          payload: {
            creatorId: audit.creatorId,
            eventIds,
            trigger: "autonomous",
            parentAuditId: audit.id,
            conversationAlias: audit.conversationAlias || `fanloom:${audit.creatorId}:advisor`,
            previousSummary,
            creatorProfile: audit.creatorProfileSnapshot,
          },
        },
      });
      queued += 1;
    } catch (error) {
      if (!(error instanceof Error) || !/unique|duplicate/i.test(error.message)) throw error;
    }
  }
  return queued;
}
