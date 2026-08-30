export type PaymentStatus = "created" | "submitted" | "settled" | "failed" | "unknown";

export type PaymentResult = { providerId: string; status: PaymentStatus; providerOperationId?: string };

export type PaymentProvider = {
  create(input: { idempotencyKey: string; amountMinor: number; currency: string }): Promise<PaymentResult>;
  get(providerId: string): Promise<PaymentResult>;
};
