import { describe, expect, it } from "vitest";
import { reconcilePayment, reconcileTip } from "../src/jobs/reconcile-payment.js";
import type { PaymentProvider } from "../../../packages/connectors/src/payments/types.js";

describe("payment reconciliation", () => {
  it("queries the original provider operation before retrying a timeout", async () => {
    const calls: string[] = [];
    const provider: PaymentProvider = {
      async create() { calls.push("create"); throw new Error("timeout"); },
      async get(providerId) { calls.push(`get:${providerId}`); return { providerId, status: "settled" }; },
    };
    const result = await reconcilePayment({ idempotencyKey: "tip-1", providerOperationId: "pay-1", provider });
    expect(calls).toEqual(["get:pay-1"]);
    expect(result.status).toBe("settled");
  });

  it("persists a settled provider result without creating a second payment", async () => {
    let updated: any;
    const provider: PaymentProvider = { async create() { throw new Error("must_not_create"); }, async get(providerId) { return { providerId, status: "settled" }; } };
    await reconcileTip({ db: { tip: { findUnique: async () => ({ id: "tip-1", idempotencyKey: "tip-1", providerOperationId: "pay-1", amountMinor: 250, currency: "USDC", status: "pending" }), update: async ({ data }: any) => { updated = data; } } }, tipId: "tip-1", provider });
    expect(updated).toMatchObject({ status: "succeeded", providerOperationId: "pay-1" });
  });
});
