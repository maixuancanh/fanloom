import type { PaymentProvider, PaymentResult } from "../../../../packages/connectors/src/payments/types.js";

export async function reconcilePayment(input: { idempotencyKey: string; providerOperationId?: string; provider: PaymentProvider; amountMinor?: number; currency?: string }): Promise<PaymentResult> {
  if (input.providerOperationId) return input.provider.get(input.providerOperationId);
  try {
    return await input.provider.create({ idempotencyKey: input.idempotencyKey, amountMinor: input.amountMinor ?? 0, currency: input.currency ?? "USDC" });
  } catch (error) {
    throw new Error(`payment_unknown:${error instanceof Error ? error.message : "provider_error"}`);
  }
}

export async function reconcileTip(input: { db: { tip: { findUnique(args: unknown): Promise<any>; update(args: unknown): Promise<unknown> } }; tipId: string; provider: PaymentProvider }): Promise<PaymentResult> {
  const tip = await input.db.tip.findUnique({ where: { id: input.tipId } });
  if (!tip) throw new Error("tip_not_found");
  if (tip.status === "succeeded" || tip.status === "failed") return { providerId: tip.providerOperationId ?? "", status: tip.status === "succeeded" ? "settled" : "failed" };
  const result = await reconcilePayment({ idempotencyKey: tip.idempotencyKey, providerOperationId: tip.providerOperationId ?? undefined, provider: input.provider, amountMinor: Number(tip.amountMinor ?? 0), currency: tip.currency });
  const status = result.status === "settled" ? "succeeded" : result.status === "failed" ? "failed" : "pending";
  await input.db.tip.update({ where: { id: tip.id }, data: { status, providerOperationId: result.providerId } });
  return result;
}
