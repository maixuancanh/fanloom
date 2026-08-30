import type { ActionConnector, ActionExecutionResult } from "../../../../packages/connectors/src/actions.js";

type ActionDb = {
  campaignAction: { findUnique(args: unknown): Promise<any>; update(args: unknown): Promise<any> };
  connectorExecution: { findUnique(args: unknown): Promise<any>; create(args: unknown): Promise<any>; update(args: unknown): Promise<any> };
};

export async function executeCampaignAction(input: { db: ActionDb; actionId: string; connector: ActionConnector }): Promise<ActionExecutionResult> {
  const action = await input.db.campaignAction.findUnique({ where: { id: input.actionId } });
  if (!action) throw new Error("action_not_found");
  if (action.status !== "approved" && action.status !== "completed") throw new Error("action_not_approved");
  const existing = await input.db.connectorExecution.findUnique({ where: { actionId: action.id } });
  if (existing?.status === "succeeded") return { status: "succeeded", providerOperationId: existing.providerOperationId, result: existing.result };
  if (action.status !== "approved") throw new Error("action_not_approved");
  const result = existing?.providerOperationId
    ? await input.connector.reconcile(existing.providerOperationId)
    : await input.connector.execute({ idempotencyKey: action.idempotencyKey, actionType: action.actionType, fanId: action.fanId, amountMinor: Number(action.amountMinor ?? 0), maxSpendMinor: Number(action.maxSpendMinor ?? 0), payload: action.payload ?? {} });
  const data = { actionId: action.id, idempotencyKey: action.idempotencyKey, connector: action.actionType, status: result.status, providerOperationId: result.providerOperationId, result: result.result ?? {} };
  if (existing) await input.db.connectorExecution.update({ where: { actionId: action.id }, data });
  else await input.db.connectorExecution.create({ data });
  if (result.status === "succeeded") await input.db.campaignAction.update({ where: { id: action.id }, data: { status: "completed" } });
  else if (result.status === "failed") await input.db.campaignAction.update({ where: { id: action.id }, data: { status: "failed" } });
  return result;
}
