export const WORKER_SERVICE = "fanloom-worker";
import { fileURLToPath } from "node:url";
import { db, type FanloomDb } from "../../../packages/db/src/client.js";
import { createMindsHttpClientFromEnv } from "../../../packages/minds/src/client.js";
import { processEngagementEvaluation } from "./evaluate-event.js";
import { processCreatorAdvisor } from "./process-advisor.js";
import { queueDueAdvisorFollowUps } from "./advisor-followups.js";
import { executeCampaignAction } from "./jobs/execute-campaign-action.js";
import { reconcileTip } from "./jobs/reconcile-payment.js";
import type { ActionConnector } from "../../../packages/connectors/src/actions.js";
import type { PaymentProvider } from "../../../packages/connectors/src/payments/types.js";
import { createPrismaOutboxStore, runWorker, type OutboxJob, type OutboxStore } from "./outbox.js";

export { createPrismaOutboxStore, runWorker, runWorkerOnce, type OutboxJob, type OutboxStore } from "./outbox.js";

type WorkerDependencies = {
  store: OutboxStore; db: FanloomDb;
  client: Parameters<typeof processEngagementEvaluation>[1]["client"] & Parameters<typeof processCreatorAdvisor>[1]["client"];
  configuredMindId: string; actionConnector?: ActionConnector; paymentProvider?: PaymentProvider; signal?: AbortSignal;
};

export function createWorkerHandlers(dependencies: WorkerDependencies) {
  return {
    "engagement.evaluate": async (job: OutboxJob) => { await processEngagementEvaluation(job as OutboxJob & { tenantId: string; communityId: string }, { client: dependencies.client, configuredMindId: dependencies.configuredMindId, db: dependencies.db as unknown as Parameters<typeof processEngagementEvaluation>[1]["db"] }); },
    "creator.advisor.evaluate": async (job: OutboxJob) => { await processCreatorAdvisor(job as OutboxJob & { tenantId: string; communityId: string; payload: { creatorId?: unknown; eventIds?: unknown } }, { client: dependencies.client, configuredMindId: dependencies.configuredMindId, db: dependencies.db as unknown as Parameters<typeof processCreatorAdvisor>[1]["db"] }); },
    "campaign.action.execute": async (job: OutboxJob) => { if (!dependencies.actionConnector) throw new Error("connector_unprovisioned:campaign-actions"); await executeCampaignAction({ db: dependencies.db as never, actionId: String(job.payload.actionId), connector: dependencies.actionConnector }); },
    "tip.reconcile": async (job: OutboxJob) => { if (!dependencies.paymentProvider) throw new Error("connector_unprovisioned:payments"); await reconcileTip({ db: dependencies.db as never, tipId: String(job.payload.tipId), provider: dependencies.paymentProvider }); },
  };
}

export function startWorker(dependencies: WorkerDependencies) {
  const sweep = () => queueDueAdvisorFollowUps(dependencies.db as unknown as Parameters<typeof queueDueAdvisorFollowUps>[0]).catch(() => undefined);
  void sweep();
  const timer = setInterval(sweep, 60_000);
  timer.unref();
  return runWorker({
    store: dependencies.store,
    signal: dependencies.signal,
    handlers: createWorkerHandlers(dependencies),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = createMindsHttpClientFromEnv();
  await startWorker({ store: createPrismaOutboxStore(db), db, client, configuredMindId: process.env.FANLOOM_MIND_ID ?? "" });
}
