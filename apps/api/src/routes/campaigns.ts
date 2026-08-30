import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canExecuteCampaignAction, isFinancialAction } from "../../../../packages/domain/src/campaign.js";
import { scoreConsentedEvidence } from "../../../../packages/domain/src/scoring.js";
import { verifySession, type Session } from "../auth/session.js";

type Db = any;
type AuthRequest = FastifyRequest & { session?: Session; sessionToken?: string };
const keyPattern = /^[\x21-\x7e]{1,255}$/;
const safeJson = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
const duplicate = (error: unknown) => error instanceof Error && /unique|duplicate/i.test(error.message);

function idempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const header = request.headers["idempotency-key"], key = Array.isArray(header) ? header[0] : header;
  if (!key || !keyPattern.test(key)) { void reply.code(400).send({ error: "idempotency_key_required" }); return null; }
  return key;
}

export async function registerCampaignRoutes(app: FastifyInstance, options: { db: Db; sessionSecret: string }): Promise<void> {
  const userFor = (s: Session) => options.db.user.findFirst ? options.db.user.findFirst({ where: { id: s.userId, tenantId: s.tenantId }, include: { creator: true } }) : options.db.user.findUnique({ where: { id: s.userId }, include: { creator: true } });
  const creatorFor = async (s: Session) => (await userFor(s))?.creator;
  const audit = (tx: Db, s: Session, communityId: string, action: string, key: string, metadata: unknown) => tx.auditEvent.create({ data: { actorId: s.userId, tenantId: s.tenantId, communityId, action, idempotencyKey: key, metadata: safeJson(metadata) } });
  const auth = (request: AuthRequest, reply: FastifyReply) => { const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : request.sessionToken; const session = request.session ?? verifySession(token, options.sessionSecret); if (!session || session.role !== "creator") { void reply.code(403).send({ error: "forbidden" }); return null; } return session; };

  app.post<{ Body: { name?: string; budgetLimitMinor?: number } }>("/v1/campaigns", async (request, reply) => {
    const s = auth(request as AuthRequest, reply); if (!s) return;
    const key = idempotencyKey(request, reply); if (!key) return;
    const body = request.body ?? {}, creator = await creatorFor(s), name = body.name;
    if (!creator || typeof name !== "string" || !name.trim()) return reply.code(400).send({ error: "invalid_campaign" });
    const limit = body.budgetLimitMinor ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 0) return reply.code(400).send({ error: "invalid_budget" });
    try {
      const result = await options.db.$transaction(async (tx: Db) => {
        await tx.idempotencyRecord.create({ data: { tenantId: s.tenantId, communityId: creator.communityId ?? s.tenantId, actorId: s.userId, callerKey: key, operation: "campaign.create", resource: name } });
        const campaign = await tx.campaign.create({ data: { creatorId: creator.id, name: name.trim(), status: "draft", budgetLimitMinor: BigInt(limit), spentMinor: BigInt(0) } });
        await audit(tx, s, creator.communityId, "campaign.created", key, { campaignId: campaign.id, budgetLimitMinor: limit });
        return campaign;
      });
      return reply.code(201).send(safeJson(result));
    } catch (error) { if (duplicate(error)) return reply.code(409).send({ error: "replayed_request" }); throw error; }
  });

  app.post<{ Params: { campaignId: string }; Body: { actionType?: "message" | "mission" | "reward" | "tip" | "no_action"; amountMinor?: number; maxSpendMinor?: number; evidenceEventIds?: string[] } }>("/v1/campaigns/:campaignId/actions", async (request, reply) => {
    const s = auth(request as AuthRequest, reply); if (!s) return;
    const key = idempotencyKey(request, reply); if (!key) return;
    const creator = await creatorFor(s), campaign = creator && await options.db.campaign.findFirst({ where: { id: request.params.campaignId, creatorId: creator.id } });
    const body = request.body ?? {}, evidenceIds = body.evidenceEventIds ?? [], actionType = body.actionType;
    if (!campaign || !creator) return reply.code(404).send({ error: "campaign_not_found" });
    if (!actionType || !Array.isArray(evidenceIds) || evidenceIds.length === 0 || evidenceIds.some((id) => typeof id !== "string")) return reply.code(400).send({ error: "consented_evidence_required" });
    const events = options.db.engagementEvent?.findMany ? await options.db.engagementEvent.findMany({ where: { id: { in: evidenceIds }, creatorId: creator.id, tenantId: s.tenantId } }) : [];
    const evidence = await Promise.all(events.map(async (event: any) => ({ eventId: event.id, kind: event.eventType, consented: Boolean(await options.db.consentGrant?.findFirst?.({ where: { fanId: event.fanId, tenantId: s.tenantId, purpose: "personalization", status: "active", revokedAt: null } })) })));
    const scored = scoreConsentedEvidence(evidence);
    if (scored.evidenceEventIds.length !== evidenceIds.length) return reply.code(403).send({ error: "consent_required" });
    const amount = body.amountMinor ?? 0, maxSpend = body.maxSpendMinor ?? amount;
    const gate = canExecuteCampaignAction({ actionType, approved: false, consented: true, amountMinor: amount, maxSpendMinor: maxSpend });
    if (!gate.ok && gate.reason !== "approval_required") return reply.code(400).send({ error: gate.reason });
    try {
      const result = await options.db.$transaction(async (tx: Db) => {
        await tx.idempotencyRecord.create({ data: { tenantId: s.tenantId, communityId: creator.communityId, actorId: s.userId, callerKey: key, operation: "campaign.action.create", resource: request.params.campaignId } });
        const action = await tx.campaignAction.create({ data: { campaignId: campaign.id, idempotencyKey: key, actionType, status: "pending", amountMinor: BigInt(amount), maxSpendMinor: BigInt(maxSpend), evidenceEventIds: scored.evidenceEventIds } });
        await audit(tx, s, creator.communityId, "campaign.action.proposed", key, { campaignId: campaign.id, actionId: action.id, score: scored.score, evidenceEventIds: scored.evidenceEventIds });
        await tx.outboxJob.create({ data: { tenantId: s.tenantId, communityId: creator.communityId, topic: "campaign.action.proposed", idempotencyKey: key, payload: { campaignId: campaign.id, actionId: action.id, actionType, financial: isFinancialAction(actionType) } } });
        return action;
      });
      return reply.code(202).send({ action: safeJson(result), status: isFinancialAction(actionType) ? "awaiting_approval" : "approved", score: scored.score, evidenceEventIds: scored.evidenceEventIds });
    } catch (error) { if (duplicate(error)) return reply.code(409).send({ error: "replayed_request" }); throw error; }
  });

  app.post<{ Params: { campaignId: string; actionId: string } }>("/v1/campaigns/:campaignId/actions/:actionId/approve", async (request, reply) => {
    const s = auth(request as AuthRequest, reply); if (!s) return;
    const key = idempotencyKey(request, reply); if (!key) return;
    const creator = await creatorFor(s), action = creator && await options.db.campaignAction.findFirst({ where: { id: request.params.actionId, campaign: { id: request.params.campaignId, creatorId: creator.id } } });
    if (!action || !creator) return reply.code(404).send({ error: "action_not_found" });
    try { const approved = await options.db.$transaction(async (tx: Db) => { const updated = await tx.campaignAction.update({ where: { id: action.id }, data: { status: "approved" } }); await tx.approval.create({ data: { actionId: action.id, status: "approved", reviewerId: s.userId, decisionHash: key, boundedSpendMinor: action.amountMinor, decidedAt: new Date() } }); await audit(tx, s, creator.communityId, "campaign.action.approved", key, { actionId: action.id, boundedSpendMinor: action.amountMinor }); await tx.outboxJob.create({ data: { tenantId: s.tenantId, communityId: creator.communityId, topic: "campaign.action.approved", idempotencyKey: key, payload: { actionId: action.id } } }); return updated; }); return reply.send(safeJson(approved)); } catch (error) { if (duplicate(error)) return reply.code(409).send({ error: "replayed_request" }); throw error; }
  });

  app.post<{ Params: { campaignId: string; actionId: string } }>("/v1/campaigns/:campaignId/actions/:actionId/execute", async (request, reply) => {
    const s = auth(request as AuthRequest, reply); if (!s) return;
    const key = idempotencyKey(request, reply); if (!key) return;
    const creator = await creatorFor(s), action = creator && await options.db.campaignAction.findFirst({ where: { id: request.params.actionId, campaign: { id: request.params.campaignId, creatorId: creator.id } } });
    if (!action || !creator) return reply.code(404).send({ error: "action_not_found" });
    const evidenceIds = Array.isArray(action.evidenceEventIds) ? action.evidenceEventIds.filter((id: unknown): id is string => typeof id === "string") : [];
    const events = options.db.engagementEvent?.findMany ? await options.db.engagementEvent.findMany({ where: { id: { in: evidenceIds }, creatorId: creator.id, tenantId: s.tenantId } }) : [];
    const consented = evidenceIds.length > 0 && events.length === evidenceIds.length && (await Promise.all(events.map((event: any) => options.db.consentGrant?.findFirst?.({ where: { fanId: event.fanId, tenantId: s.tenantId, purpose: "personalization", status: "active", revokedAt: null } })))).every(Boolean);
    const gate = canExecuteCampaignAction({ actionType: action.actionType, approved: action.status === "approved", consented, amountMinor: Number(action.amountMinor ?? 0), maxSpendMinor: Number(action.maxSpendMinor ?? action.amountMinor ?? 0) });
    if (!gate.ok) return reply.code(409).send({ error: gate.reason });
    try { const result = await options.db.$transaction(async (tx: Db) => { const campaign = await tx.campaign.findUnique({ where: { id: request.params.campaignId } }); const amount = BigInt(action.amountMinor ?? 0); if (!campaign) throw new Error("campaign_not_found"); await tx.idempotencyRecord.create({ data: { tenantId: s.tenantId, communityId: creator.communityId, actorId: s.userId, callerKey: key, operation: "campaign.action.execute", resource: action.id } }); const updatedBudget = tx.campaign.updateMany ? await tx.campaign.updateMany({ where: { id: campaign.id, spentMinor: { lte: BigInt(campaign.budgetLimitMinor ?? 0) - amount } }, data: { spentMinor: { increment: amount } } }) : { count: BigInt(campaign.spentMinor ?? 0) + amount <= BigInt(campaign.budgetLimitMinor ?? 0) ? 1 : 0 }; if (updatedBudget.count !== 1) throw new Error("budget_exceeded"); const updated = await tx.campaignAction.update({ where: { id: action.id }, data: { status: "executed" } }); await audit(tx, s, creator.communityId, "campaign.action.executed", key, { actionId: action.id, amountMinor: amount }); await tx.outboxJob.create({ data: { tenantId: s.tenantId, communityId: creator.communityId, topic: "campaign.action.execute", idempotencyKey: key, payload: { actionId: action.id, actionType: action.actionType } } }); return updated; }); return reply.code(202).send(safeJson(result)); } catch (error) { if (error instanceof Error && error.message === "budget_exceeded") return reply.code(409).send({ error: error.message }); if (error instanceof Error && error.message === "campaign_not_found") return reply.code(404).send({ error: error.message }); if (duplicate(error)) return reply.code(409).send({ error: "replayed_request" }); throw error; }
  });
}
