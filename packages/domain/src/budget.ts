export type SpendResult =
  | { ok: true; spentMinor: number }
  | { ok: false; reason: "budget_exceeded" | "duplicate_idempotency_key" | "invalid_amount" };

export function canSpend(input: { limitMinor: number; spentMinor: number; requestedMinor: number }): boolean {
  return Number.isSafeInteger(input.limitMinor) && input.limitMinor >= 0
    && Number.isSafeInteger(input.spentMinor) && input.spentMinor >= 0
    && Number.isSafeInteger(input.requestedMinor) && input.requestedMinor >= 0
    && input.spentMinor + input.requestedMinor <= input.limitMinor;
}

/** A synchronous reservation boundary: callers must use this operation as the single spend mutation. */
export class BudgetLedger {
  private spentMinor = 0;
  private readonly keys = new Set<string>();

  constructor(private readonly input: { limitMinor: number }) {
    if (!Number.isSafeInteger(input.limitMinor) || input.limitMinor < 0) throw new Error("invalid_budget");
  }

  get spent() { return this.spentMinor; }
  get remaining() { return this.input.limitMinor - this.spentMinor; }

  reserve(input: { amountMinor: number; idempotencyKey: string }): SpendResult {
    if (this.keys.has(input.idempotencyKey)) return { ok: false, reason: "duplicate_idempotency_key" };
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) return { ok: false, reason: "invalid_amount" };
    if (!canSpend({ limitMinor: this.input.limitMinor, spentMinor: this.spentMinor, requestedMinor: input.amountMinor })) return { ok: false, reason: "budget_exceeded" };
    this.keys.add(input.idempotencyKey);
    this.spentMinor += input.amountMinor;
    return { ok: true, spentMinor: this.spentMinor };
  }
}
