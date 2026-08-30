import type { Money } from "./types.js";

export type FinancialActionType = "reward" | "tip";

type MoneyInput = {
  amountMinor?: unknown;
  currency?: unknown;
};

const POSTGRES_BIGINT_MAX = 9223372036854775807n;

function fail(): never {
  throw new Error("financial_validation_failed");
}

export function validateMoney(input: unknown): Money {
  if (!input || typeof input !== "object") fail();
  const { amountMinor, currency } = input as MoneyInput;
  if (
    typeof amountMinor !== "string" ||
    !/^\d+$/.test(amountMinor) ||
    BigInt(amountMinor) > POSTGRES_BIGINT_MAX
  ) fail();
  if (typeof currency !== "string" || !/^[A-Z]{3,10}$/.test(currency)) fail();
  return { amountMinor, currency };
}

export function validateCampaignActionFinancialFields(
  actionType: string,
  input: unknown,
): Money | undefined {
  if (actionType === "reward" || actionType === "tip") return validateMoney(input);
  if (!input || typeof input !== "object") return undefined;
  const fields = input as MoneyInput;
  if (fields.amountMinor === undefined && fields.currency === undefined) return undefined;
  return validateMoney(input);
}
