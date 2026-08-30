import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyCsrfToken, verifySession } from "../auth/session.js";

const profileFields = ["displayName", "niche", "audience", "priorityChannels", "goal30Day", "differentiator"] as const;
const allowedChannels = new Set(["Instagram", "TikTok", "YouTube", "Spotify", "Discord", "Telegram", "X", "Twitch", "Newsletter"]);
type CreatorProfile = { id: string; displayName: string; niche: string | null; audience: string | null; priorityChannels: string[]; goal30Day: string | null; differentiator: string | null };

function normalizedProfile(creator: any): CreatorProfile & { complete: boolean; missingFields: string[] } {
  const profile: CreatorProfile = {
    id: String(creator.id),
    displayName: typeof creator.displayName === "string" ? creator.displayName.trim() : "",
    niche: typeof creator.niche === "string" ? creator.niche.trim() : null,
    audience: typeof creator.audience === "string" ? creator.audience.trim() : null,
    priorityChannels: Array.isArray(creator.priorityChannels) ? creator.priorityChannels.filter((item: unknown): item is string => typeof item === "string" && allowedChannels.has(item)) : [],
    goal30Day: typeof creator.goal30Day === "string" ? creator.goal30Day.trim() : null,
    differentiator: typeof creator.differentiator === "string" ? creator.differentiator.trim() : null,
  };
  const missingFields = profileFields.filter((field) => field === "priorityChannels" ? profile.priorityChannels.length === 0 : !profile[field]);
  return { ...profile, complete: missingFields.length === 0, missingFields: [...missingFields] };
}

function parseProfile(body: unknown): Omit<CreatorProfile, "id"> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const strings = ["displayName", "niche", "audience", "goal30Day", "differentiator"] as const;
  if (strings.some((field) => typeof value[field] !== "string" || !(value[field] as string).trim() || (value[field] as string).trim().length > 500)) return null;
  if (!Array.isArray(value.priorityChannels) || value.priorityChannels.length < 1 || value.priorityChannels.length > 5 || value.priorityChannels.some((item) => typeof item !== "string" || !allowedChannels.has(item))) return null;
  return {
    displayName: (value.displayName as string).trim(), niche: (value.niche as string).trim(), audience: (value.audience as string).trim(),
    priorityChannels: [...new Set(value.priorityChannels as string[])], goal30Day: (value.goal30Day as string).trim(), differentiator: (value.differentiator as string).trim(),
  };
}

export async function registerDashboardRoutes(app: FastifyInstance, options: { db: any; sessionSecret: string; allowedOrigin: string; localDemo: boolean }): Promise<void> {
  const creatorFor = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined, session = verifySession(token, options.sessionSecret);
    if (!session || session.role !== "creator") { reply.code(403).send({ error: "forbidden" }); return null; }
    const user = await options.db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId }, include: { creator: true } });
    if (!user?.creator) { reply.code(403).send({ error: "forbidden" }); return null; }
    return { session, creator: user.creator };
  };

  app.get("/v1/dashboard/creator", async (request, reply) => {
    const context = await creatorFor(request, reply); if (!context) return;
    return reply.send({ creator: normalizedProfile(context.creator) });
  });

  app.post("/v1/dashboard/advisor/follow-up-demo", async (request, reply) => {
    if (!options.localDemo) return reply.code(404).send({ error: "not_found" });
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    const session = verifySession(token, options.sessionSecret);
    if (!session || session.role !== "creator") return reply.code(403).send({ error: "forbidden" });
    const csrf = request.headers["x-csrf-token"];
    const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;
    if (request.headers.origin !== options.allowedOrigin || !verifyCsrfToken(csrfToken, token ?? "", request.headers.origin ?? "", options.sessionSecret)) return reply.code(403).send({ error: "csrf_rejected" });
    const context = await creatorFor(request, reply); if (!context) return;
    const checkpoint = await options.db.mindAdvisorAudit.findFirst({
      where: { creatorId: context.creator.id, tenantId: context.session.tenantId, recommendation: { not: null }, conversationAlias: { not: "" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, followUpAt: true },
    });
    if (!checkpoint) return reply.code(409).send({ error: "checkpoint_not_found" });
    const dueAt = checkpoint.followUpAt && checkpoint.followUpAt <= new Date() ? checkpoint.followUpAt : new Date();
    const updated = await options.db.mindAdvisorAudit.update({ where: { id: checkpoint.id }, data: { followUpAt: dueAt }, select: { id: true, followUpAt: true } });
    return reply.send({ auditId: updated.id, followUpAt: updated.followUpAt, status: "due" });
  });

  app.patch<{ Body: unknown }>("/v1/dashboard/creator", async (request, reply) => {
    const context = await creatorFor(request, reply); if (!context) return;
    const profile = parseProfile(request.body);
    if (!profile) return reply.code(400).send({ error: "invalid_creator_profile" });
    const updated = await options.db.creator.update({ where: { id: context.creator.id }, data: profile });
    return reply.send({ creator: normalizedProfile(updated) });
  });

  app.get("/v1/dashboard/campaigns", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined, session = verifySession(token, options.sessionSecret);
    if (!session || session.role !== "creator") return reply.code(403).send({ error: "forbidden" });
    const user = await options.db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId }, include: { creator: true } }), creatorId = user?.creator?.id;
    if (!creatorId) return reply.code(403).send({ error: "forbidden" });
    const campaigns = await options.db.campaign.findMany({ where: { creatorId }, include: { actions: { include: { connectorExecution: true }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } });
    return reply.send({ campaigns: campaigns.map((campaign: any) => ({ id: campaign.id, name: campaign.name, status: campaign.status, budgetLimitMinor: String(campaign.budgetLimitMinor), spentMinor: String(campaign.spentMinor), actions: (campaign.actions ?? []).map((action: any) => ({ id: action.id, actionType: action.actionType, status: action.status, amountMinor: String(action.amountMinor ?? 0), maxSpendMinor: String(action.maxSpendMinor ?? 0), executionStatus: action.connectorExecution?.status ?? "not_started" })) })) });
  });
  app.get("/v1/dashboard/audience", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined, session = verifySession(token, options.sessionSecret);
    if (!session || session.role !== "creator") return reply.code(403).send({ error: "forbidden" });
    const user = await options.db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId }, include: { creator: true } }), creatorId = user?.creator?.id;
    if (!creatorId) return reply.code(403).send({ error: "forbidden" });
    const fans = await options.db.fan.findMany({ where: { creatorId, tenantId: session.tenantId }, include: { consents: true, events: true, rewards: true }, orderBy: { createdAt: "desc" } });
    return reply.send({ fans: fans.map((fan: any) => ({ id: fan.id, handle: fan.handle, joinedAt: fan.createdAt, engagementCount: fan.events?.length ?? 0, rewardBalanceMinor: String((fan.rewards ?? []).reduce((total: bigint, item: any) => total + BigInt(item.entryType === "spend" ? -item.amountMinor : item.amountMinor), 0n)), personalizationConsent: fan.consents?.find((item: any) => item.purpose === "personalization")?.status ?? "missing" })) });
  });
  app.get("/v1/dashboard/advisor", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined, session = verifySession(token, options.sessionSecret);
    if (!session || session.role !== "creator") return reply.code(403).send({ error: "forbidden" });
    const user = await options.db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId }, include: { creator: true } }), creatorId = user?.creator?.id;
    if (!creatorId) return reply.code(403).send({ error: "forbidden" });
    const audits = await options.db.mindAdvisorAudit.findMany({ where: { creatorId, tenantId: session.tenantId, conversationAlias: { not: "" } }, orderBy: { createdAt: "desc" }, select: { id: true, recommendation: true, followUpAt: true, mindId: true, conversationAlias: true, trigger: true, parentAuditId: true, creatorProfileSnapshot: true, createdAt: true } });
    const contextualAudits = audits.filter((audit: any) => typeof audit.conversationAlias === "string" && audit.conversationAlias.length > 0);
    const auditById = new Map<string, any>(contextualAudits.map((audit: any) => [audit.id, audit]));
    const continuityDepth = (audit: any) => {
      let depth = 0, parentId = audit.parentAuditId;
      const seen = new Set<string>([audit.id]);
      while (typeof parentId === "string" && auditById.has(parentId) && !seen.has(parentId)) {
        depth += 1; seen.add(parentId); parentId = auditById.get(parentId)?.parentAuditId;
      }
      return depth;
    };
    return reply.send({ recommendations: contextualAudits.flatMap((audit: any) => {
      const item = audit.recommendation;
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      return [{ id: audit.id, summary: item.summary, evidenceEventIds: item.evidenceEventIds, recommendationType: item.recommendationType, draft: item.draft, followUpAt: audit.followUpAt, mindId: audit.mindId, conversationAlias: audit.conversationAlias, trigger: audit.trigger, parentAuditId: audit.parentAuditId, creatorProfileSnapshot: audit.creatorProfileSnapshot, continuityDepth: continuityDepth(audit), createdAt: audit.createdAt, draftOnly: true }];
    }) });
  });
  app.post<{ Body: { eventIds?: unknown } }>("/v1/dashboard/advisor/requests", async (request, reply) => {
    const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined, session = verifySession(token, options.sessionSecret);
    if (!session || session.role !== "creator") return reply.code(403).send({ error: "forbidden" });
    const keyHeader = request.headers["idempotency-key"], key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!key || !/^[\x21-\x7e]{1,255}$/.test(key)) return reply.code(400).send({ error: "idempotency_key_required" });
    const eventIds = request.body?.eventIds;
    if (!Array.isArray(eventIds) || eventIds.length === 0 || eventIds.some((id) => typeof id !== "string" || !id.trim())) return reply.code(400).send({ error: "consented_evidence_required" });
    const user = await options.db.user.findFirst({ where: { id: session.userId, tenantId: session.tenantId }, include: { creator: true } }), creator = user?.creator;
    if (!creator) return reply.code(403).send({ error: "forbidden" });
    const creatorProfile = normalizedProfile(creator);
    if (!creatorProfile.complete) return reply.code(409).send({ error: "creator_profile_incomplete", missingFields: creatorProfile.missingFields });
    const events = await options.db.engagementEvent.findMany({ where: { id: { in: eventIds }, creatorId: creator.id, tenantId: session.tenantId } });
    if (events.length !== eventIds.length) return reply.code(403).send({ error: "consent_required" });
    const consents = await Promise.all(events.map((event: any) => options.db.consentGrant.findFirst({ where: { fanId: event.fanId, tenantId: session.tenantId, purpose: "personalization", status: "active", revokedAt: null } })));
    if (consents.some((consent: unknown) => !consent)) return reply.code(403).send({ error: "consent_required" });
    try {
      const previous = options.db.mindAdvisorAudit?.findFirst ? await options.db.mindAdvisorAudit.findFirst({ where: { creatorId: creator.id, tenantId: session.tenantId, recommendation: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, recommendation: true } }) : null;
      const previousSummary = previous?.recommendation && typeof previous.recommendation === "object" && !Array.isArray(previous.recommendation) && typeof previous.recommendation.summary === "string" ? previous.recommendation.summary : undefined;
      const profileSnapshot = { id: creatorProfile.id, displayName: creatorProfile.displayName, niche: creatorProfile.niche, audience: creatorProfile.audience, priorityChannels: creatorProfile.priorityChannels, goal30Day: creatorProfile.goal30Day, differentiator: creatorProfile.differentiator };
      const job = await options.db.outboxJob.create({ data: { tenantId: session.tenantId, communityId: creator.communityId, topic: "creator.advisor.evaluate", idempotencyKey: key, payload: { creatorId: creator.id, eventIds, trigger: "manual", conversationAlias: `fanloom:${creator.id}:advisor`, parentAuditId: previous?.id, previousSummary, creatorProfile: profileSnapshot } } });
      return reply.code(202).send({ id: job.id, status: "queued", draftOnly: true });
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) return reply.code(409).send({ error: "replayed_request" });
      throw error;
    }
  });
}
