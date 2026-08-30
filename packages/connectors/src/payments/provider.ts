import { createUnprovisionedConnector } from "../actions.js";
import type { PaymentProvider } from "./types.js";

export function createUnprovisionedPaymentProvider(name = "payments"): PaymentProvider {
  const connector = createUnprovisionedConnector(name);
  return {
    async create(input) { const result = await connector.execute({ idempotencyKey: input.idempotencyKey, actionType: "payment", amountMinor: input.amountMinor, payload: { currency: input.currency } }); return { providerId: result.providerOperationId ?? "", status: "unknown" }; },
    async get(providerId) { await connector.reconcile(providerId); return { providerId, status: "unknown" }; },
  };
}
