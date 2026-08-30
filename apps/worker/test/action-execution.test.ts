import { describe, expect, it } from "vitest";
import { executeCampaignAction } from "../src/jobs/execute-campaign-action.js";
import type { ActionConnector } from "../../../packages/connectors/src/actions.js";

describe("campaign action execution", () => {
  it("executes an approved action once and persists the connector boundary", async () => {
    let calls = 0;
    const action = { id: "action-1", campaignId: "campaign-1", status: "approved", actionType: "message", idempotencyKey: "action-key", amountMinor: 0, maxSpendMinor: 0, fanId: "fan-1", payload: {} };
    const state: any = { action, execution: null };
    const db: any = {
      campaignAction: { findUnique: async () => state.action, update: async ({ data }: any) => Object.assign(state.action, data) },
      connectorExecution: { findUnique: async () => state.execution, create: async ({ data }: any) => { state.execution = data; return data; }, update: async ({ data }: any) => Object.assign(state.execution, data) },
    };
    const connector: ActionConnector = { async execute() { calls += 1; return { status: "succeeded", providerOperationId: "provider-1" }; }, async reconcile(id) { return { status: "succeeded", providerOperationId: id }; } };
    await executeCampaignAction({ db, actionId: "action-1", connector });
    await executeCampaignAction({ db, actionId: "action-1", connector });
    expect(calls).toBe(1);
    expect(state.execution).toMatchObject({ status: "succeeded", providerOperationId: "provider-1", idempotencyKey: "action-key" });
    expect(state.action.status).toBe("completed");
  });

  it("does not call a connector for an unapproved action", async () => {
    let calls = 0;
    await expect(executeCampaignAction({ db: { campaignAction: { findUnique: async () => ({ id: "action-1", status: "awaiting_approval" }) } }, actionId: "action-1", connector: { execute: async () => { calls += 1; return { status: "succeeded" }; }, reconcile: async () => ({ status: "succeeded" }) } })).rejects.toThrow("action_not_approved");
    expect(calls).toBe(0);
  });
});
