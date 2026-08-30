import { evaluateCampaign, type MindClient } from "../../../packages/minds/src/index.js";

type EvaluationDb = { mindEvaluationAudit: { upsert(args: { where: { outboxJobId: string }; create: { [key: string]: unknown }; update: { [key: string]: unknown } }): Promise<unknown> } };
type OutboxEvaluation = { id: string; tenantId: string; communityId: string; payload: { eventId?: string; eventIds?: string[] } };

export async function processEngagementEvaluation(job: OutboxEvaluation, options: { client: MindClient; configuredMindId: string; db: EvaluationDb }) {
  const events = job.payload.eventIds ?? (job.payload.eventId ? [job.payload.eventId] : []);
  const result = await evaluateCampaign(options.client, { events, configuredMindId: options.configuredMindId, alias: `fanloom:${options.configuredMindId}:engagement` });
  const data = { outboxJobId: job.id, tenantId: job.tenantId, communityId: job.communityId, requestId: result.ok ? result.requestId : `rejected:${job.id}`, transcriptRef: result.ok ? result.transcriptRef : undefined, decision: result.ok ? result.decision : undefined, validation: result.ok ? { ok: true } : { ok: false, reason: result.reason } };
  await options.db.mindEvaluationAudit.upsert({ where: { outboxJobId: job.id }, create: data, update: data });
  return result;
}
