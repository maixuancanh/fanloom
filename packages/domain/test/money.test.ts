import { describe, expect, it } from "vitest";
import { validateCampaignActionFinancialFields, validateMoney } from "../src/money.js";

describe("validateMoney", () => {
  it("accepts JSON-safe nonnegative integer minor units and uppercase currency", () => {
    expect(validateMoney({ amountMinor: "1500", currency: "USDC" })).toEqual({ amountMinor: "1500", currency: "USDC" });
    expect(validateMoney({ amountMinor: "9223372036854775807", currency: "USDC" })).toEqual({ amountMinor: "9223372036854775807", currency: "USDC" });
  });

  it("accepts the maximum ten-character uppercase currency code", () => {
    expect(validateMoney({ amountMinor: "0", currency: "ABCDEFGHIJ" })).toEqual({ amountMinor: "0", currency: "ABCDEFGHIJ" });
  });

  it.each([
    { amountMinor: "-1", currency: "USDC" },
    { amountMinor: "1.5", currency: "USDC" },
    { amountMinor: "", currency: "USDC" },
    { amountMinor: "1", currency: "usd" },
    { amountMinor: "1", currency: "US" },
    { amountMinor: "1", currency: "TOOLONGCURR" },
    { amountMinor: "9223372036854775808", currency: "USDC" },
  ])("rejects invalid financial fields: $amountMinor/$currency", (input) => {
    expect(() => validateMoney(input)).toThrow("financial_validation_failed");
  });
});

describe("validateCampaignActionFinancialFields", () => {
  it("requires money for reward and tip actions", () => {
    expect(() => validateCampaignActionFinancialFields("reward", {})).toThrow("financial_validation_failed");
    expect(() => validateCampaignActionFinancialFields("tip", { amountMinor: "1" })).toThrow("financial_validation_failed");
  });

  it("allows absent money only for nonfinancial actions", () => {
    expect(validateCampaignActionFinancialFields("message", {})).toBeUndefined();
  });
});
