import { describe, expect, it } from "vitest";
import { createUnprovisionedConnector, type ActionConnector } from "../src/actions.js";

describe("action connectors", () => {
  it("fails closed when a live connector is not provisioned", async () => {
    const connector = createUnprovisionedConnector("minds");
    await expect(connector.execute({ idempotencyKey: "action-1", actionType: "message", payload: {} })).rejects.toThrow("connector_unprovisioned:minds");
  });

  it("defines a durable execution contract with provider reconciliation", async () => {
    const calls: string[] = [];
    const connector: ActionConnector = {
      async execute(input) { calls.push(input.idempotencyKey); return { status: "submitted", providerOperationId: "provider-1" }; },
      async reconcile(providerOperationId) { return { status: "succeeded", providerOperationId }; },
    };
    expect(await connector.execute({ idempotencyKey: "action-1", actionType: "message", payload: {} })).toMatchObject({ status: "submitted" });
    expect(await connector.reconcile("provider-1")).toMatchObject({ status: "succeeded" });
    expect(calls).toEqual(["action-1"]);
  });
});
